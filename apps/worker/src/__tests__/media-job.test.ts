import { randomUUID } from "node:crypto";
import type { Database } from "@crmwsp/db";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { createBspMediaLoader } from "../ai/media.js";
import { attachmentStorageKey, processStoreMedia, type MediaStore } from "../media/index.js";

interface Row {
  storageKey: string | null;
  externalMediaId: string | null;
  mimeType: string | null;
  conversationId: string;
}

/** Fake Database: only the query shapes used by processStoreMedia; no network, no Postgres. */
function fakeDb(row: Row | undefined) {
  const updates: Array<Record<string, unknown>> = [];
  let inTx = 0;
  const tx = {
    execute: async () => undefined,
    select: () => {
      const chain: Record<string, unknown> = {};
      chain["from"] = () => chain;
      chain["innerJoin"] = () => chain;
      chain["where"] = () => chain;
      chain["limit"] = async () => (row ? [row] : []);
      return chain;
    },
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          updates.push(v);
          // Mirrors "where storage_key is null": a concurrent winner is not overwritten.
          if (row && row.storageKey === null) row.storageKey = String(v["storageKey"]);
        },
      }),
    }),
  };
  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      inTx++;
      try {
        return await fn(tx);
      } finally {
        inTx--;
      }
    },
  } as unknown as Database;
  return { db, updates, openTx: () => inTx };
}

function fakeStore() {
  const objects = new Map<string, { data: Uint8Array; contentType: string }>();
  const store: MediaStore = {
    put: vi.fn(async (key, data, contentType) => void objects.set(key, { data, contentType })),
    get: vi.fn(async (key) => {
      const o = objects.get(key);
      if (!o) throw new Error("NoSuchKey");
      return { data: o.data, contentType: o.contentType };
    }),
  };
  return { store, objects };
}

const tenantId = randomUUID();
const attachmentId = randomUUID();
const conversationId = randomUUID();
const baseRow = (): Row => ({ storageKey: null, externalMediaId: "https://bsp/x", mimeType: "audio/ogg", conversationId });
const bytes = new Uint8Array([1, 2, 3, 4]);

describe("processStoreMedia", () => {
  it("downloads, uploads and fills storage_key/size/mime without holding a tx during I/O", async () => {
    const { db, updates, openTx } = fakeDb(baseRow());
    const { store, objects } = fakeStore();
    const txDuringIo: number[] = [];
    const loadMedia = vi.fn(async () => {
      txDuringIo.push(openTx());
      return { data: bytes, mimeType: "audio/ogg; codecs=opus" };
    });
    (store.put as ReturnType<typeof vi.fn>).mockImplementation(async (k: string, d: Uint8Array, c: string) => {
      txDuringIo.push(openTx());
      objects.set(k, { data: d, contentType: c });
    });

    const res = await processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId });

    const key = attachmentStorageKey(tenantId, attachmentId, "audio/ogg; codecs=opus");
    expect(key).toBe(`tenants/${tenantId}/attachments/${attachmentId}.ogg`);
    expect(res).toEqual({ status: "stored", storageKey: key, sizeBytes: 4 });
    expect(updates).toEqual([{ storageKey: key, sizeBytes: 4, mimeType: "audio/ogg; codecs=opus" }]);
    expect(objects.get(key)?.contentType).toBe("audio/ogg; codecs=opus");
    expect(txDuringIo).toEqual([0, 0]);
  });

  it("is idempotent: an already stored attachment is not downloaded again", async () => {
    const row = { ...baseRow(), storageKey: "tenants/x/y.ogg" };
    const { db, updates } = fakeDb(row);
    const { store } = fakeStore();
    const loadMedia = vi.fn();
    const res = await processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId });
    expect(res).toEqual({ status: "already_stored" });
    expect(loadMedia).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("a second run after success does nothing", async () => {
    const { db } = fakeDb(baseRow());
    const { store } = fakeStore();
    const loadMedia = vi.fn(async () => ({ data: bytes, mimeType: "audio/ogg" }));
    const first = await processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId });
    const second = await processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId });
    expect(first.status).toBe("stored");
    expect(second.status).toBe("already_stored");
    expect(loadMedia).toHaveBeenCalledTimes(1);
  });

  it("download failure throws (BullMQ retries), logs only the class and leaves storage_key null", async () => {
    const row = baseRow();
    const { db, updates } = fakeDb(row);
    const { store } = fakeStore();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const loadMedia = vi.fn(async () => {
      throw new Error("secret-token-in-url");
    });
    await expect(processStoreMedia({ db, store, loadMedia, logger }, { tenantId, attachmentId })).rejects.toThrow();
    expect(row.storageKey).toBeNull();
    expect(updates).toHaveLength(0);
    expect(store.put).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token");
  });

  it("upload failure throws and does not set storage_key", async () => {
    const row = baseRow();
    const { db, updates } = fakeDb(row);
    const { store } = fakeStore();
    (store.put as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("S3 down"));
    const loadMedia = vi.fn(async () => ({ data: bytes, mimeType: "audio/ogg" }));
    await expect(processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId })).rejects.toThrow("S3 down");
    expect(row.storageKey).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it("skips attachments without an external media id and rejects invalid job data without retry", async () => {
    const { db } = fakeDb({ ...baseRow(), externalMediaId: null });
    const { store } = fakeStore();
    const loadMedia = vi.fn();
    expect(await processStoreMedia({ db, store, loadMedia }, { tenantId, attachmentId })).toMatchObject({ status: "skipped" });
    await expect(processStoreMedia({ db, store, loadMedia }, { tenantId: "nope", attachmentId })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe("createBspMediaLoader storage preference", () => {
  const ref = { tenantId, conversationId, externalMediaId: "https://bsp/x", mimeType: "audio/ogg" };
  const unusedProvider = { downloadMedia: vi.fn() };

  it("reads from the store when storage_key is set", async () => {
    const { db } = fakeDb({ ...baseRow(), storageKey: "k1" });
    const { store, objects } = fakeStore();
    objects.set("k1", { data: bytes, contentType: "audio/ogg" });
    const load = createBspMediaLoader({ db, cipher: {} as never, provider: unusedProvider as never, store });
    expect(await load(ref)).toEqual({ data: bytes, mimeType: "audio/ogg" });
    expect(unusedProvider.downloadMedia).not.toHaveBeenCalled();
  });

  it("falls back to the BSP path when the stored object cannot be read", async () => {
    const { db } = fakeDb({ ...baseRow(), storageKey: "missing" });
    const { store } = fakeStore();
    const load = createBspMediaLoader({ db, cipher: {} as never, provider: unusedProvider as never, store });
    // The BSP path needs a channel row; the fake returns the attachment row shape, which has no
    // credentials, so it rejects with "channel unavailable" - proving the fallback was reached.
    await expect(load(ref)).rejects.toThrow("channel unavailable");
  });
});
