import { describe, expect, it, vi } from "vitest";
import { ResendWebhookController, type RawRequest } from "./resend-webhook.controller.js";
import { signSvix, verifySvixSignature } from "./svix-signature.js";

const SECRET = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const NOW = 1_800_000_000;
const event = { type: "email.received", created_at: "2026-10-24T10:00:00Z", data: { email_id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c", from: "a@b.co" } };

function request(body: object, opts: { ts?: number; tamper?: boolean; secret?: string } = {}): RawRequest {
  const raw = Buffer.from(JSON.stringify(body));
  const ts = String(opts.ts ?? NOW);
  const sig = signSvix(opts.secret ?? SECRET, "msg_1", ts, raw);
  return {
    headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": `v1,${sig}` },
    rawBody: opts.tamper ? Buffer.from(JSON.stringify({ ...body, x: 1 })) : raw,
  };
}

function setup(secret: string | null = SECRET, inserted = true) {
  const ingest = vi.fn(async () => ({ eventId: "00000000-0000-4000-8000-000000000001", inserted }));
  const add = vi.fn(async () => undefined);
  const ctrl = new ResendWebhookController({ ingest }, { add }, secret, () => NOW);
  const reply = { status: 0, code(s: number) { this.status = s; return this; }, send: vi.fn() };
  return { ctrl, reply, ingest, add };
}

describe("verifySvixSignature", () => {
  it("accepts a valid signature among several", () => {
    const raw = Buffer.from("{}");
    const sig = signSvix(SECRET, "id", String(NOW), raw);
    expect(verifySvixSignature(raw, { id: "id", timestamp: String(NOW), signature: `v1,AAAA v1,${sig}` }, SECRET, NOW)).toBe("ok");
  });
  it("rejects tampered bodies, old timestamps and missing headers", () => {
    const raw = Buffer.from("{}");
    const sig = signSvix(SECRET, "id", String(NOW), raw);
    expect(verifySvixSignature(Buffer.from("{ }"), { id: "id", timestamp: String(NOW), signature: `v1,${sig}` }, SECRET, NOW)).toBe("invalid");
    expect(verifySvixSignature(raw, { id: "id", timestamp: String(NOW), signature: `v1,${sig}` }, SECRET, NOW + 301)).toBe("stale");
    expect(verifySvixSignature(raw, { id: undefined, timestamp: String(NOW), signature: `v1,${sig}` }, SECRET, NOW)).toBe("missing");
    expect(verifySvixSignature(raw, { id: "id", timestamp: String(NOW), signature: `v2,${sig}` }, SECRET, NOW)).toBe("invalid");
  });
});

describe("ResendWebhookController", () => {
  it("stores and enqueues a valid email.received", async () => {
    const { ctrl, reply, ingest, add } = setup();
    await ctrl.receive(request(event), reply);
    expect(reply.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith(`resend:${event.data.email_id}`, event);
    expect(add).toHaveBeenCalledOnce();
  });
  it("401 and nothing stored on tampered, stale, wrong-secret or unconfigured", async () => {
    const other = `whsec_${Buffer.from("ffffffffffffffffffffffffffffffff").toString("base64")}`;
    for (const [req, secret] of [
      [request(event, { tamper: true }), SECRET],
      [request(event, { ts: NOW - 600 }), SECRET],
      [request(event, { secret: other }), SECRET],
      [request(event), null],
    ] as const) {
      const { ctrl, reply, ingest } = setup(secret);
      await ctrl.receive(req, reply);
      expect(reply.status).toBe(401);
      expect(ingest).not.toHaveBeenCalled();
    }
  });
  it("re-enqueues a duplicate delivery under the same job id (idempotent)", async () => {
    const { ctrl, reply, add } = setup(SECRET, false);
    await ctrl.receive(request(event), reply);
    expect(reply.status).toBe(200);
    expect(add).toHaveBeenCalledWith("process-resend-email", { eventId: "00000000-0000-4000-8000-000000000001" }, expect.objectContaining({ jobId: "resend-00000000-0000-4000-8000-000000000001" }));
  });
  it("503 when the queue is down so Resend retries", async () => {
    const { ctrl, reply, add } = setup();
    add.mockRejectedValueOnce(new Error("redis"));
    await ctrl.receive(request(event), reply);
    expect(reply.status).toBe(503);
  });
  it("acknowledges other event types without storing", async () => {
    const { ctrl, reply, ingest } = setup();
    await ctrl.receive(request({ type: "email.delivered", data: {} }), reply);
    expect(reply.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });
  it("400 on a malformed email id", async () => {
    const { ctrl, reply } = setup();
    await ctrl.receive(request({ type: "email.received", data: { email_id: "../../x" } }), reply);
    expect(reply.status).toBe(400);
  });
});
