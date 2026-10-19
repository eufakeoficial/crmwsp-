import { randomBytes, randomUUID } from "node:crypto";
import { createCipherBox, type CipherBox } from "@crmwsp/crypto";
import { channelConnections, contacts, conversations, messages, type DbHandle } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { Queue, QueueEvents } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createOutboundWorker, GUPSHUP_API_KEY_PURPOSE, processSendMessage } from "../outbound.js";
import type { EventPublisher } from "../processors.js";
import { createRedis, SEND_MESSAGE_JOB } from "../queue.js";
import { APP_URL, MIGRATOR_URL, REDIS_URL, createDb, dropTenants, hasEnv, seedTenants, type SeedTenant } from "./helpers.js";

const API_KEY = `gs-key-${randomUUID()}`;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe.skipIf(!hasEnv)("send-message processor (Postgres + Redis, mocked Gupshup fetch)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let conversationId: string;
  let cipher: CipherBox;
  const published: Array<{ channel: string; message: string }> = [];
  const publisher: EventPublisher = {
    publish: async (channel, message) => {
      published.push({ channel, message });
      return 1;
    },
  };

  async function queuedMessage(text = "Hola desde el inbox"): Promise<string> {
    const [m] = await migrator.db
      .insert(messages)
      .values({
        tenantId: A.tenantId,
        conversationId,
        direction: "outbound",
        type: "text",
        body: text,
        status: "queued",
        author: "user",
        clientMessageId: randomUUID(),
      })
      .returning({ id: messages.id });
    return m!.id;
  }

  async function load(id: string) {
    const [m] = await migrator.db.select().from(messages).where(eq(messages.id, id));
    return m!;
  }

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string);
    [A] = (await seedTenants(migrator, 1)) as [SeedTenant];
    // Test-only master key (equivalent to `openssl rand -base64 32`).
    cipher = createCipherBox({ keys: new Map([[1, randomBytes(32)]]), activeKeyId: 1 });
    await migrator.db
      .update(channelConnections)
      .set({
        externalAppId: "DemoApp",
        credentialsEncrypted: cipher.encrypt(API_KEY, { tenantId: A.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE }),
      })
      .where(eq(channelConnections.id, A.connectionId));
    const [c] = await migrator.db
      .insert(contacts)
      .values({ tenantId: A.tenantId, phoneE164: "+5491155550000" })
      .returning({ id: contacts.id });
    const [conv] = await migrator.db
      .insert(conversations)
      .values({ tenantId: A.tenantId, contactId: c!.id, channelConnectionId: A.connectionId, lastInboundAt: new Date() })
      .returning({ id: conversations.id });
    conversationId = conv!.id;
  });

  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, A ? [A.tenantId] : []);
      await migrator.close();
    }
    await app?.close();
  });

  it("calls Gupshup with the decrypted key, stores external_id and publishes; reprocessing does not resend", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { status: "submitted", messageId: "gs-ext-1" }));
    const logs: string[] = [];
    const logger = { info: (m: string) => logs.push(m), warn: (m: string) => logs.push(m), error: (m: string) => logs.push(m) };
    const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher, logger };
    const id = await queuedMessage("Texto secreto 123");

    const out = await processSendMessage(deps, { tenantId: A.tenantId, messageId: id });
    expect(out).toEqual({ outcome: "sent", externalId: `gs-ext-1` });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.gupshup.io/wa/api/v1/msg");
    expect((init.headers as Record<string, string>)["apikey"]).toBe(API_KEY);
    const form = new URLSearchParams(String(init.body));
    expect(form.get("destination")).toBe("5491155550000");
    expect(form.get("src.name")).toBe("DemoApp");
    expect(JSON.parse(form.get("message") ?? "{}")).toMatchObject({ type: "text", text: "Texto secreto 123" });

    const row = await load(id);
    expect(row).toMatchObject({ externalId: "gs-ext-1", status: "sent" });
    expect(row.sentAt).toBeInstanceOf(Date);
    expect(published.at(-1)).toEqual({
      channel: `tenant:${A.tenantId}:events`,
      message: JSON.stringify({ type: "message.status", conversationId, messageId: id }),
    });

    const again = await processSendMessage(deps, { tenantId: A.tenantId, messageId: id });
    expect(again).toEqual({ outcome: "skipped", reason: "already-sent" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logs.join("\n")).not.toContain(API_KEY);
    expect(logs.join("\n")).not.toContain("Texto secreto");
  });

  it("two concurrent workers on the same message send it only once (row lock)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchMock = vi.fn(async () => {
      await gate;
      return jsonResponse(200, { status: "submitted", messageId: "gs-ext-race" });
    });
    const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
    const id = await queuedMessage();
    const first = processSendMessage(deps, { tenantId: A.tenantId, messageId: id });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const second = await processSendMessage(deps, { tenantId: A.tenantId, messageId: id });
    release();
    expect(await first).toEqual({ outcome: "sent", externalId: "gs-ext-race" });
    expect(second).toEqual({ outcome: "skipped", reason: "locked" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await load(id)).toMatchObject({ status: "sent", externalId: "gs-ext-race" });
  });

  it("a forged tenantId finds nothing (RLS)", async () => {
    const id = await queuedMessage();
    const deps = { db: app.db, provider: new GupshupProvider({ fetch: vi.fn() as unknown as typeof fetch }), publisher, cipher };
    await expect(processSendMessage(deps, { tenantId: randomUUID(), messageId: id })).rejects.toThrow(/message not found/);
  });

  describe("through the BullMQ worker", () => {
    const queueName = `outbound-test-${randomUUID()}`;
    let queue: Queue;
    let events: QueueEvents;

    beforeAll(async () => {
      queue = new Queue(queueName, { connection: createRedis(REDIS_URL as string) });
      events = new QueueEvents(queueName, { connection: createRedis(REDIS_URL as string) });
      await events.waitUntilReady();
    });

    afterAll(async () => {
      await queue?.obliterate({ force: true });
      await queue?.close();
      await events?.close();
    });

    async function run(fetchMock: typeof fetch, id: string) {
      const connection = createRedis(REDIS_URL as string);
      const worker = createOutboundWorker({
        connection,
        queueName,
        db: app.db,
        provider: new GupshupProvider({ fetch: fetchMock }),
        publisher,
        cipher,
      });
      try {
        const job = await queue.add(
          SEND_MESSAGE_JOB,
          { tenantId: A.tenantId, messageId: id },
          { jobId: id, attempts: 5, backoff: { type: "fixed", delay: 10 } },
        );
        const result = await job.waitUntilFinished(events, 15_000);
        return { result, job: await queue.getJob(id) };
      } finally {
        await worker.close();
        connection.disconnect();
      }
    }

    it("a 400 marks the message failed without retrying", async () => {
      const fetchMock = vi.fn(async () => jsonResponse(400, { status: "error", message: "Invalid destination" }));
      const id = await queuedMessage();
      const { result, job } = await run(fetchMock as unknown as typeof fetch, id);
      expect(result).toEqual({ outcome: "failed" });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(job?.attemptsMade).toBe(1);
      const row = await load(id);
      expect(row.status).toBe("failed");
      expect(row.externalId).toBeNull();
      expect(row.error).toEqual({ code: "provider_error", message: "Gupshup responded with HTTP 400", status: 400 });
      expect(JSON.stringify(row.error)).not.toContain(API_KEY);
    });

    it("a 503 is retried with backoff and then succeeds", async () => {
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        return calls < 3 ? jsonResponse(503, {}) : jsonResponse(200, { status: "submitted", messageId: "gs-ext-retry" });
      });
      const id = await queuedMessage();
      const { result, job } = await run(fetchMock as unknown as typeof fetch, id);
      expect(result).toEqual({ outcome: "sent", externalId: "gs-ext-retry" });
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(job?.attemptsMade).toBe(3);
      expect(await load(id)).toMatchObject({ status: "sent", externalId: "gs-ext-retry" });
    });

    it("a 503 on every attempt ends failed after 5 attempts", async () => {
      const fetchMock = vi.fn(async () => jsonResponse(503, {}));
      const id = await queuedMessage();
      const { result, job } = await run(fetchMock as unknown as typeof fetch, id);
      expect(result).toEqual({ outcome: "failed" });
      expect(fetchMock).toHaveBeenCalledTimes(5);
      expect(job?.attemptsMade).toBe(5);
      expect((await load(id)).status).toBe("failed");
    });
  });
});
