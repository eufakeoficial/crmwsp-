import "reflect-metadata";
import { MAX_IMAGE_BYTES, NotFoundError, OutsideServiceWindowError, StorageNotConfiguredError, ValidationError, messageSchema, outboundMediaUploadSchema } from "@crmwsp/contracts";
import { attachments, conversations, messages, type Transaction } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { ROLES_KEY } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { RequestTenant } from "../common/http.js";
import type { TenantDb } from "../db/tenant-db.js";
import type { PlanLimitsService } from "../billing/plan-limits.service.js";
import { StorageHolder, type ObjectStorage } from "../storage/object-storage.js";
import { OutboundMediaController } from "./outbound-media.controller.js";

const TENANT = "00000000-0000-4000-8000-000000000001";
const CONVERSATION = "00000000-0000-4000-8000-000000000002";
const USER = "00000000-0000-4000-8000-000000000003";
const tenant = { id: TENANT, role: "agent" } as RequestTenant;
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function multipart(files: Array<{ data: Buffer; mime: string; fieldname?: string }>) {
  async function* parts() {
    for (const item of files) {
      yield {
        type: "file" as const,
        fieldname: item.fieldname ?? "file",
        mimetype: item.mime,
        file: Object.assign((async function* () { yield item.data; })(), { destroy: vi.fn() }),
        toBuffer: async () => item.data,
      };
    }
  }
  return { headers: {}, ip: "127.0.0.1", isMultipart: () => true, parts };
}

function setup(options: { visible?: boolean; restricted?: boolean; storage?: boolean; auditFail?: boolean } = {}) {
  const objects = new Map<string, Uint8Array>();
  const storage: ObjectStorage = {
    put: vi.fn(async (key, data) => { objects.set(key, data); }),
    signedGetUrl: vi.fn(async () => "https://storage.example/preview"),
    exists: vi.fn(async (key) => objects.has(key)),
    delete: vi.fn(async (key) => { objects.delete(key); }),
  };
  const holder = new StorageHolder(options.storage === false ? null : storage);
  const planLimits = {
    assertSubscriptionActive: vi.fn(async () => {
      if (options.restricted) throw new Error("Subscription restricted");
    }),
  } as unknown as PlanLimitsService;
  const audits: Array<Record<string, unknown>> = [];
  const tx = {
    select: () => {
      const chain: Record<string, unknown> = {};
      for (const k of ["from", "where"]) chain[k] = () => chain;
      chain["then"] = (resolve: (v: unknown) => unknown) => Promise.resolve([{ settings: { inbox: { visibility: "own" } } }]).then(resolve);
      return chain;
    },
    execute: async () => options.visible === false ? [] : [{ id: CONVERSATION }],
    insert: () => ({ values: async (value: Record<string, unknown>) => {
      if (options.auditFail) throw new Error("Audit failed");
      audits.push(value);
    } }),
  };
  const db = {
    tenantId: TENANT,
    userId: USER,
    run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction),
  } as unknown as TenantDb;
  const controller = new OutboundMediaController(holder, planLimits, { add: vi.fn() } as never, { publish: vi.fn() } as never);
  return { controller, db, storage, objects, audits, planLimits };
}

describe("OutboundMediaController", () => {
  it("allows only owner, admin and agent behind TenantGuard", () => {
    expect(Reflect.getMetadata("__guards__", OutboundMediaController)).toContain(TenantGuard);
    expect(Reflect.getMetadata(ROLES_KEY, OutboundMediaController.prototype.upload)).toEqual(["owner", "admin", "agent"]);
  });

  it("uploads a JPEG and returns a signed preview without sending a message", async () => {
    const { controller, db, storage, objects, audits } = setup();
    const result = await controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }]));
    expect(outboundMediaUploadSchema.safeParse(result).success).toBe(true);
    expect(result).toMatchObject({ mime: "image/jpeg", size: jpeg.length, previewUrl: "https://storage.example/preview" });
    const key = "tenants/" + TENANT + "/outbound/" + CONVERSATION + "/" + result.uploadId + ".jpg";
    expect(storage.put).toHaveBeenCalledWith(key, jpeg, "image/jpeg");
    expect(storage.signedGetUrl).toHaveBeenCalledWith(key, 300);
    expect(objects.has(key)).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entity: "conversation", entityId: CONVERSATION, action: "message.media_uploaded", diff: { uploadId: result.uploadId, mime: "image/jpeg", size: jpeg.length } });
    expect(JSON.stringify(audits)).not.toContain(result.previewUrl);
  });

  it("rejects false image content", async () => {
    const { controller, db, storage } = setup();
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: Buffer.from("plain text"), mime: "image/png" }]))).rejects.toBeInstanceOf(ValidationError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects WebP because WhatsApp images are JPEG or PNG only", async () => {
    const { controller, db, storage } = setup();
    const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: webp, mime: "image/webp" }]))).rejects.toBeInstanceOf(ValidationError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects images over 5 MB while streaming", async () => {
    const { controller, db, storage } = setup();
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: Buffer.alloc(MAX_IMAGE_BYTES + 1), mime: "image/jpeg" }]))).rejects.toBeInstanceOf(ValidationError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects two files", async () => {
    const { controller, db, storage } = setup();
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }, { data: jpeg, mime: "image/jpeg" }]))).rejects.toBeInstanceOf(ValidationError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    const { controller, db, storage } = setup();
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([]))).rejects.toBeInstanceOf(ValidationError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("returns 503 when storage is not configured", async () => {
    const { controller, db } = setup({ storage: false });
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }]))).rejects.toBeInstanceOf(StorageNotConfiguredError);
  });

  it("rejects an invisible conversation without storing an object", async () => {
    const { controller, db, storage, objects } = setup({ visible: false });
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }]))).rejects.toBeInstanceOf(NotFoundError);
    expect(storage.put).not.toHaveBeenCalled();
    expect(objects.size).toBe(0);
  });

  it("rejects a restricted subscription", async () => {
    const { controller, db, storage } = setup({ restricted: true });
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }]))).rejects.toThrow("Subscription restricted");
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("rejects a malformed conversation id", async () => {
    const { controller, db, storage } = setup();
    await expect(controller.upload(db, tenant, "bad-id", multipart([{ data: jpeg, mime: "image/jpeg" }]))).rejects.toBeInstanceOf(NotFoundError);
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("removes the object if the audit transaction fails", async () => {
    const { controller, db, storage, objects } = setup({ auditFail: true });
    await expect(controller.upload(db, tenant, CONVERSATION, multipart([{ data: jpeg, mime: "image/jpeg" }]))).rejects.toThrow("Audit failed");
    expect(storage.delete).toHaveBeenCalledOnce();
    expect(objects.size).toBe(0);
  });
});

const UPLOAD = "00000000-0000-4000-8000-000000000004";
const CLIENT_MESSAGE = "00000000-0000-4000-8000-000000000005";
const MESSAGE = "00000000-0000-4000-8000-000000000006";
const key = "tenants/" + TENANT + "/outbound/" + CONVERSATION + "/" + UPLOAD + ".jpg";

function sendSetup(options: { visible?: boolean; restricted?: boolean; inWindow?: boolean; exists?: boolean } = {}) {
  let row: Record<string, unknown> | undefined;
  const attached: Array<Record<string, unknown>> = [];
  const queue = { add: vi.fn(async () => undefined) };
  const hub = { publish: vi.fn(async () => undefined) };
  const storage = { put: vi.fn(), delete: vi.fn(), signedGetUrl: vi.fn(), exists: vi.fn(async () => options.exists !== false) };
  const planLimits = { assertSubscriptionActive: vi.fn(async () => {
    if (options.restricted) throw new Error("Subscription restricted");
  }) };
  const tx = {
    execute: async () => options.visible === false ? [] : [{ id: CONVERSATION }],
    select: () => {
      let table: unknown;
      const chain = {
        from(value: unknown) { table = value; return chain; },
        where() { return chain; },
        orderBy() { return chain; },
        for() { return chain; },
        then(resolve: (value: unknown) => unknown) {
          let value: unknown = [];
          if (table === conversations) value = [{ id: CONVERSATION, contactId: USER, inWindow: options.inWindow !== false }];
          else if (table === messages) value = row ? [row] : [];
          else if (table === attachments) value = attached;
          else value = [{ settings: { inbox: { visibility: "own", pauseAutomationOnAgentReplyMinutes: 0 } } }];
          return Promise.resolve(value).then(resolve);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({ values: (value: Record<string, unknown>) => {
      if (table === messages) {
        const inserted = row ? [] : [row = { ...value, id: MESSAGE, createdAt: new Date(), sentAt: null, error: null, reaction: null, reactionBy: null }];
        return { onConflictDoNothing: () => ({ returning: async () => inserted }) };
      }
      if (table === attachments) attached.push({ ...value, id: UPLOAD, transcript: null });
      return Promise.resolve();
    } }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  const db = { tenantId: TENANT, userId: USER, run: <T>(fn: (t: Transaction) => Promise<T>) => fn(tx as unknown as Transaction) } as unknown as TenantDb;
  const controller = new OutboundMediaController(new StorageHolder(storage as never), planLimits as never, queue as never, hub as never);
  const body = { uploadId: UPLOAD, mime: "image/jpeg", caption: " Foto ", clientMessageId: CLIENT_MESSAGE };
  const req = { headers: {}, ip: "127.0.0.1" };
  return { controller, db, body, req, queue, hub, storage, attached, get row() { return row; } };
}

describe("send media message", () => {
  it("returns an image DTO and enqueues once", async () => {
    const f = sendSetup();
    const dto = await f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req);
    expect(messageSchema.safeParse(dto).success).toBe(true);
    expect(dto).toMatchObject({ id: MESSAGE, type: "image", body: "Foto", status: "queued", attachments: [{ storageKey: key, mimeType: "image/jpeg", sizeBytes: null }] });
    expect(f.queue.add).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ jobId: MESSAGE }));
    expect(f.hub.publish).toHaveBeenCalledOnce();
  });

  it("returns the same message on retry without creating another attachment", async () => {
    const f = sendSetup();
    await f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req);
    await f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req);
    expect(f.attached).toHaveLength(1);
    expect(f.hub.publish).toHaveBeenCalledOnce();
    expect(f.queue.add).toHaveBeenCalledTimes(2);
    expect(f.queue.add).toHaveBeenNthCalledWith(2, expect.anything(), expect.anything(), expect.objectContaining({ jobId: MESSAGE }));
  });

  it("rejects outside the service window", async () => {
    const f = sendSetup({ inWindow: false });
    await expect(f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req)).rejects.toBeInstanceOf(OutsideServiceWindowError);
    expect(f.row).toBeUndefined();
  });

  it("rejects an upload that does not exist", async () => {
    const f = sendSetup({ exists: false });
    await expect(f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req)).rejects.toBeInstanceOf(NotFoundError);
    expect(f.row).toBeUndefined();
  });

  it("limits the route to owner, admin and agent", () => {
    expect(Reflect.getMetadata(ROLES_KEY, OutboundMediaController.prototype.send)).toEqual(["owner", "admin", "agent"]);
  });

  it("rejects a conversation outside the agent's scope", async () => {
    const f = sendSetup({ visible: false });
    await expect(f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req)).rejects.toBeInstanceOf(NotFoundError);
    expect(f.row).toBeUndefined();
  });

  it("rejects a restricted subscription", async () => {
    const f = sendSetup({ restricted: true });
    await expect(f.controller.send(f.db, tenant, CONVERSATION, f.body, f.req)).rejects.toThrow("Subscription restricted");
    expect(f.row).toBeUndefined();
  });
});
