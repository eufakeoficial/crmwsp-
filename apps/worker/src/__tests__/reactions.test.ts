import { randomBytes, randomUUID } from "node:crypto";
import { createCipherBox, type CipherBox } from "@crmwsp/crypto";
import { channelConnections, contacts, conversations, messages, withTenant, type DbHandle } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GUPSHUP_API_KEY_PURPOSE, processSendReaction } from "../outbound.js";
import { processIngestMessage, type EventPublisher } from "../processors.js";
import { APP_URL, MIGRATOR_URL, createDb, dropTenants, hasEnv, ingest, seedTenants, textPayload, type SeedTenant } from "./helpers.js";

const API_KEY = `gs-key-${randomUUID()}`;
const PHONE = "5491155559999";

const reactionPayload = (id: string, target: string, emoji: string): unknown => ({
  app: "DemoApp",
  timestamp: 1729339200000,
  version: 2,
  type: "message",
  payload: { id, source: PHONE, type: "reaction", payload: { emoji, msgId: target }, sender: { phone: PHONE, name: "Juan" } },
});

describe.skipIf(!hasEnv)("emoji reactions (Postgres, mocked Gupshup)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let conversationId: string;
  let cipher: CipherBox;
  const published: string[] = [];
  const publisher: EventPublisher = {
    publish: async (_c, message) => {
      published.push(message);
      return 1;
    },
  };

  const outboundMessage = async (externalId: string) => {
    const [m] = await migrator.db
      .insert(messages)
      .values({ tenantId: A.tenantId, conversationId, direction: "outbound", type: "text", body: "hola", status: "sent", author: "user", externalId })
      .returning({ id: messages.id });
    return m!.id;
  };
  const inboundMessage = async (externalId: string, reaction?: { emoji: string; by: "ai" | "user" }) => {
    const [m] = await migrator.db
      .insert(messages)
      .values({
        tenantId: A.tenantId,
        conversationId,
        direction: "inbound",
        type: "text",
        body: "gracias",
        status: "received",
        author: "contact",
        externalId,
        ...(reaction ? { reaction: reaction.emoji, reactionBy: reaction.by } : {}),
      })
      .returning({ id: messages.id });
    return m!.id;
  };
  const load = async (id: string) => (await migrator.db.select().from(messages).where(eq(messages.id, id)))[0]!;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 4 });
    [A] = (await seedTenants(migrator, 1)) as [SeedTenant];
    cipher = createCipherBox({ keys: new Map([[1, randomBytes(32)]]), activeKeyId: 1 });
    await migrator.db
      .update(channelConnections)
      .set({
        externalAppId: "DemoApp",
        credentialsEncrypted: cipher.encrypt(API_KEY, { tenantId: A.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE }),
      })
      .where(eq(channelConnections.id, A.connectionId));
    const [c] = await migrator.db.insert(contacts).values({ tenantId: A.tenantId, phoneE164: `+${PHONE}` }).returning({ id: contacts.id });
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

  describe("inbound customer reactions", () => {
    const deps = () => ({ db: app.db, provider: new GupshupProvider(), publisher });

    it("decorates our message instead of creating a new one, and is idempotent", async () => {
      const target = `wamid-${randomUUID()}`;
      const id = await outboundMessage(target);
      const before = (await migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId))).length;
      const evId = `wamid-${randomUUID()}`;
      const eventId = await ingest(app, A.token, `msg:${evId}`, reactionPayload(evId, target, "👍"));
      const res = await processIngestMessage(deps(), { eventId, tenantId: A.tenantId });
      expect(res).toMatchObject({ duplicate: true, reactedMessageId: id });
      expect(await load(id)).toMatchObject({ reaction: "👍", reactionBy: "contact" });
      expect((await migrator.db.select().from(messages).where(eq(messages.conversationId, conversationId))).length).toBe(before);
      expect(published.at(-1)).toBe(JSON.stringify({ type: "message.status", conversationId, messageId: id }));

      await processIngestMessage(deps(), { eventId, tenantId: A.tenantId });
      expect(await load(id)).toMatchObject({ reaction: "👍", reactionBy: "contact" });
    });

    it("an empty emoji removes the reaction; an unknown target is ignored", async () => {
      const target = `wamid-${randomUUID()}`;
      const id = await outboundMessage(target);
      const e1 = `wamid-${randomUUID()}`;
      await processIngestMessage(deps(), { eventId: await ingest(app, A.token, `msg:${e1}`, reactionPayload(e1, target, "❤️")), tenantId: A.tenantId });
      expect((await load(id)).reaction).toBe("❤️");
      const e2 = `wamid-${randomUUID()}`;
      await processIngestMessage(deps(), { eventId: await ingest(app, A.token, `msg:${e2}`, reactionPayload(e2, target, "")), tenantId: A.tenantId });
      expect(await load(id)).toMatchObject({ reaction: null, reactionBy: null });

      const e3 = `wamid-${randomUUID()}`;
      const res = await processIngestMessage(deps(), {
        eventId: await ingest(app, A.token, `msg:${e3}`, reactionPayload(e3, "wamid-unknown", "👍")),
        tenantId: A.tenantId,
      });
      expect(res.duplicate).toBe(true);
    });

    it("a reaction never opens a conversation for an unknown phone", async () => {
      const e = `wamid-${randomUUID()}`;
      const payload = reactionPayload(e, "wamid-x", "👍") as { payload: { source: string } };
      payload.payload.source = "5491100077777";
      await processIngestMessage(deps(), { eventId: await ingest(app, A.token, `msg:${e}`, payload), tenantId: A.tenantId });
      const rows = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(contacts).where(eq(contacts.phoneE164, "+5491100077777")));
      expect(rows).toHaveLength(0);
    });

    it("a plain text message still ingests normally", async () => {
      const e = `wamid-${randomUUID()}`;
      const res = await processIngestMessage(deps(), { eventId: await ingest(app, A.token, `msg:${e}`, textPayload(e, PHONE, "Hola")), tenantId: A.tenantId });
      expect(res.duplicate).toBe(false);
    });
  });

  describe("send-reaction", () => {
    it("posts a reaction session message to the customer's message id", async () => {
      const ext = `wamid-${randomUUID()}`;
      const id = await inboundMessage(ext, { emoji: "🙏", by: "ai" });
      const fetchMock = vi.fn(async () => json(200, { status: "submitted", messageId: "gs-r-1" }));
      const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
      const out = await processSendReaction(deps, { tenantId: A.tenantId, messageId: id, emoji: "🙏" });
      expect(out).toEqual({ outcome: "sent" });
      const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      const form = new URLSearchParams(String(init.body));
      expect(form.get("destination")).toBe(PHONE);
      expect(JSON.parse(form.get("message") ?? "{}")).toEqual({ type: "reaction", msgId: ext, emoji: "🙏" });
      expect((await load(id)).reaction).toBe("🙏");
    });

    it("skips a stale job whose emoji no longer matches the stored reaction", async () => {
      const id = await inboundMessage(`wamid-${randomUUID()}`, { emoji: "👍", by: "user" });
      const fetchMock = vi.fn(async () => json(200, { status: "submitted", messageId: "gs-r-2" }));
      const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
      expect(await processSendReaction(deps, { tenantId: A.tenantId, messageId: id, emoji: "🎉" })).toEqual({ outcome: "skipped", reason: "stale" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends an empty emoji to remove the reaction", async () => {
      const ext = `wamid-${randomUUID()}`;
      const id = await inboundMessage(ext);
      const fetchMock = vi.fn(async () => json(200, { status: "submitted", messageId: "gs-r-3" }));
      const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
      expect(await processSendReaction(deps, { tenantId: A.tenantId, messageId: id, emoji: "" })).toEqual({ outcome: "sent" });
      const form = new URLSearchParams(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
      expect(JSON.parse(form.get("message") ?? "{}")).toEqual({ type: "reaction", msgId: ext, emoji: "" });
    });

    it("a permanent provider failure clears the stored reaction and notifies the inbox", async () => {
      const id = await inboundMessage(`wamid-${randomUUID()}`, { emoji: "🎉", by: "ai" });
      const fetchMock = vi.fn(async () => json(400, { status: "error" }));
      const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
      expect(await processSendReaction(deps, { tenantId: A.tenantId, messageId: id, emoji: "🎉" })).toEqual({ outcome: "failed" });
      expect(await load(id)).toMatchObject({ reaction: null, reactionBy: null });
      expect(published.at(-1)).toBe(JSON.stringify({ type: "message.status", conversationId, messageId: id }));
    });

    it("a transient failure is rethrown for BullMQ to retry and keeps the reaction", async () => {
      const id = await inboundMessage(`wamid-${randomUUID()}`, { emoji: "😊", by: "ai" });
      const fetchMock = vi.fn(async () => json(503, {}));
      const deps = { db: app.db, provider: new GupshupProvider({ fetch: fetchMock as typeof fetch }), publisher, cipher };
      await expect(processSendReaction(deps, { tenantId: A.tenantId, messageId: id, emoji: "😊" }, { attemptsMade: 0, maxAttempts: 5 })).rejects.toThrow();
      expect((await load(id)).reaction).toBe("😊");
    });
  });
});
