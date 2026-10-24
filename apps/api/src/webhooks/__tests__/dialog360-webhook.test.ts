import "reflect-metadata";
import { describe, expect, it, vi } from "vitest";
import { createDefaultWhatsAppProvider, generateWebhookToken } from "@crmwsp/whatsapp";
import type { Queue } from "bullmq";
import type { BspProvider, InboundEventStore, IngestResult } from "../inbound-event-store.js";
import { Dialog360WebhooksController } from "../webhooks.controller.js";
import { WebhooksService } from "../webhooks.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Mimics ingest_inbound_event: unique (provider, dedupe_key), token resolves the tenant per provider. */
class FakeStore implements InboundEventStore {
  readonly rows = new Map<string, string>();
  readonly calls: Array<{ provider: BspProvider; dedupeKey: string }> = [];
  constructor(private readonly validToken: string, private readonly provider: BspProvider) {}

  async ingest(token: string, dedupeKey: string, _payload: unknown, _sig: boolean, provider: BspProvider = "gupshup"): Promise<IngestResult | null> {
    this.calls.push({ provider, dedupeKey });
    if (token !== this.validToken || provider !== this.provider) return null;
    const key = `${provider}:${dedupeKey}`;
    const existing = this.rows.get(key);
    if (existing) return { eventId: existing, tenantId: TENANT, inserted: false };
    const id = `00000000-0000-4000-8000-${String(this.rows.size + 1).padStart(12, "0")}`;
    this.rows.set(key, id);
    return { eventId: id, tenantId: TENANT, inserted: true };
  }
}

const textBody = (id: string) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "5491140000000", phone_number_id: "P" },
            messages: [{ from: "5491155551234", id, timestamp: "1729339200", type: "text", text: { body: "hola" } }],
          },
        },
      ],
    },
  ],
});

function setup() {
  const token = generateWebhookToken();
  const store = new FakeStore(token, "360dialog");
  const add = vi.fn(async (..._args: unknown[]) => undefined);
  const service = new WebhooksService(store, { add } as unknown as Queue, createDefaultWhatsAppProvider());
  const controller = new Dialog360WebhooksController(service);
  const reply = () => {
    const r = { status: 0, code: vi.fn((c: number) => ((r.status = c), r)), send: vi.fn(() => r) };
    return r;
  };
  return { token, store, add, service, controller, reply };
}

describe("360dialog webhook ingestion", () => {
  it("stores one event per message id and enqueues an ingest-message job", async () => {
    const { token, store, add, controller, reply } = setup();
    const r = reply();
    await controller.receive(token, textBody("wamid.A"), r);
    expect(r.status).toBe(200);
    expect(store.calls).toEqual([{ provider: "360dialog", dedupeKey: "msg:wamid.A" }]);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith("ingest-message", { eventId: expect.any(String), tenantId: TENANT }, expect.objectContaining({ jobId: expect.any(String) }));
  });

  it("is idempotent: a redelivery reuses the same event and job id", async () => {
    const { token, store, add, controller, reply } = setup();
    await controller.receive(token, textBody("wamid.A"), reply());
    await controller.receive(token, textBody("wamid.A"), reply());
    expect(store.rows.size).toBe(1);
    const ids = add.mock.calls.map((c) => (c as unknown as [string, unknown, { jobId: string }])[2].jobId);
    expect(new Set(ids).size).toBe(1);
  });

  it("enqueues statuses as ingest-status", async () => {
    const { token, add, controller, reply } = setup();
    const body = {
      object: "whatsapp_business_account",
      entry: [{ id: "W", changes: [{ field: "messages", value: { messaging_product: "whatsapp", statuses: [{ id: "wamid.O", status: "read", timestamp: "1729339260", recipient_id: "5491155551234" }] } }] }],
    };
    await controller.receive(token, body, reply());
    expect(add.mock.calls[0]![0]).toBe("ingest-status");
  });

  it("answers 401 for a wrong token and for a malformed one, without touching the queue", async () => {
    const { add, controller, reply } = setup();
    const wrong = reply();
    await controller.receive(generateWebhookToken(), textBody("wamid.B"), wrong);
    expect(wrong.status).toBe(401);
    const bad = reply();
    await controller.receive("short", textBody("wamid.B"), bad);
    expect(bad.status).toBe(401);
    expect(add).not.toHaveBeenCalled();
  });

  it("a token of another BSP does not resolve a 360dialog callback", async () => {
    const token = generateWebhookToken();
    const store = new FakeStore(token, "gupshup");
    const service = new WebhooksService(store, { add: vi.fn() } as unknown as Queue, createDefaultWhatsAppProvider());
    expect(await service.handle("360dialog", token, textBody("wamid.C"))).toBe("unknown-token");
  });

  it("stores unsupported payloads once for audit and does not enqueue", async () => {
    const { token, store, add, controller, reply } = setup();
    const r = reply();
    await controller.receive(token, { object: "page" }, r);
    expect(r.status).toBe(200);
    expect(store.calls[0]!.dedupeKey).toMatch(/^ignored:[0-9a-f]{64}$/);
    expect(add).not.toHaveBeenCalled();
  });

  it("answers 503 when ingestion fails so 360dialog retries", async () => {
    const { token, service, controller, reply } = setup();
    vi.spyOn(service, "handle").mockRejectedValueOnce(new Error("db down"));
    const r = reply();
    await controller.receive(token, textBody("wamid.D"), r);
    expect(r.status).toBe(503);
  });
});
