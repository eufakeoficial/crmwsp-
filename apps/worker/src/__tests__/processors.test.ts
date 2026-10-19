import { randomUUID } from "node:crypto";
import { attachments, contacts, conversations, inboundEvents, messages, withTenant, type DbHandle } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { UnrecoverableError } from "bullmq";
import { eq } from "drizzle-orm";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processIngestMessage, processIngestStatus, tenantChannel, type EventPublisher } from "../processors.js";
import { canAdvance } from "../status.js";
import {
  APP_URL,
  MIGRATOR_URL,
  REDIS_URL,
  createDb,
  dropTenants,
  hasEnv,
  imagePayload,
  ingest,
  seedTenants,
  statusPayload,
  textPayload,
  type SeedTenant,
} from "./helpers.js";

describe("status ordering", () => {
  it("only moves forward; failed wins except after read", () => {
    expect(canAdvance("sent", "delivered")).toBe(true);
    expect(canAdvance("delivered", "sent")).toBe(false);
    expect(canAdvance("read", "failed")).toBe(false);
    expect(canAdvance("delivered", "failed")).toBe(true);
    expect(canAdvance("failed", "read")).toBe(false);
  });
});

describe.skipIf(!hasEnv)("inbound processors (Postgres + Redis)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  let publisher: Redis;
  let A: SeedTenant;
  let B: SeedTenant;
  const published: Array<{ channel: string; message: string }> = [];
  const provider = new GupshupProvider();
  let deps: { db: DbHandle["db"]; provider: GupshupProvider; publisher: EventPublisher };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 12 });
    publisher = new Redis(REDIS_URL as string, { lazyConnect: true });
    [A, B] = (await seedTenants(migrator, 2)) as [SeedTenant, SeedTenant];
    deps = {
      db: app.db,
      provider,
      publisher: {
        publish: async (channel, message) => {
          published.push({ channel, message });
          return publisher.publish(channel, message);
        },
      },
    };
  });

  afterAll(async () => {
    if (migrator) {
      await dropTenants(migrator, [A?.tenantId, B?.tenantId].filter((x): x is string => Boolean(x)));
      await migrator.close();
    }
    await app?.close();
    publisher?.disconnect();
  });

  it("creates contact, conversation and message, and marks the event processed", async () => {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000001", "Hola", "Ana"));
    const res = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    expect(res.duplicate).toBe(false);

    await withTenant(app.db, A.tenantId, async (tx) => {
      const [c] = await tx.select().from(contacts).where(eq(contacts.phoneE164, "+5491100000001"));
      expect(c?.name).toBe("Ana");
      const [cv] = await tx.select().from(conversations).where(eq(conversations.id, res.conversationId));
      expect(cv?.contactId).toBe(c?.id);
      expect(cv?.lastInboundAt).not.toBeNull();
      expect(cv?.lastMessageAt).not.toBeNull();
      const [m] = await tx.select().from(messages).where(eq(messages.id, res.messageId));
      expect(m).toMatchObject({ externalId: extId, body: "Hola", direction: "inbound", status: "received" });
      const [ev] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId));
      expect(ev?.processedAt).not.toBeNull();
      expect(ev?.error).toBeNull();
    });
  });

  it("is idempotent when the job is replayed", async () => {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000002"));
    const first = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    const second = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    expect(second).toEqual({ ...first, duplicate: true });
    const rows = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.externalId, extId)),
    );
    expect(rows).toHaveLength(1);
  });

  it("stores media as an attachment pending download", async () => {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, A.token, `msg:${extId}`, imagePayload(extId, "5491100000003"));
    const res = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    const att = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(attachments).where(eq(attachments.messageId, res.messageId)),
    );
    expect(att).toHaveLength(1);
    expect(att[0]).toMatchObject({ mimeType: "image/jpeg", storageKey: null });
    expect(att[0]?.externalMediaId).toBeTruthy();
  });

  it("10 concurrent messages from one contact -> 1 conversation, 10 messages", async () => {
    const phone = "5491100000010";
    const ids = Array.from({ length: 10 }, () => `wamid-${randomUUID()}`);
    const events = await Promise.all(ids.map((id) => ingest(app, A.token, `msg:${id}`, textPayload(id, phone))));
    const results = await Promise.all(events.map((eventId) => processIngestMessage(deps, { eventId, tenantId: A.tenantId })));
    expect(new Set(results.map((r) => r.conversationId)).size).toBe(1);
    const convId = results[0]?.conversationId as string;
    const rows = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.conversationId, convId)),
    );
    expect(rows).toHaveLength(10);
  });

  it("status delivered then sent stays delivered; unknown message is not an error", async () => {
    const extId = `wamid-${randomUUID()}`;
    const inEvent = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000020"));
    const { conversationId } = await processIngestMessage(deps, { eventId: inEvent, tenantId: A.tenantId });
    const outId = randomUUID();
    await withTenant(app.db, A.tenantId, (tx) =>
      tx.insert(messages).values({
        tenantId: A.tenantId,
        conversationId,
        direction: "outbound",
        type: "text",
        body: "Hi",
        externalId: outId,
        status: "queued",
        author: "user",
      }),
    );
    const delivered = await ingest(app, A.token, `status:${outId}:delivered`, statusPayload(outId, "delivered"));
    const sent = await ingest(app, A.token, `status:${outId}:sent`, statusPayload(outId, "sent"));
    expect((await processIngestStatus(deps, { eventId: delivered, tenantId: A.tenantId })).updated).toBe(true);
    expect((await processIngestStatus(deps, { eventId: sent, tenantId: A.tenantId })).updated).toBe(false);
    const [m] = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.externalId, outId)),
    );
    expect(m?.status).toBe("delivered");

    const ghost = randomUUID();
    const ghostEvent = await ingest(app, A.token, `status:${ghost}:read`, statusPayload(ghost, "read"));
    await expect(processIngestStatus(deps, { eventId: ghostEvent, tenantId: A.tenantId })).resolves.toEqual({
      updated: false,
    });
  });

  it("concurrent statuses (sent, delivered, read) always end at read", async () => {
    const extId = `wamid-${randomUUID()}`;
    const inEvent = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000021"));
    const { conversationId } = await processIngestMessage(deps, { eventId: inEvent, tenantId: A.tenantId });
    for (let round = 0; round < 5; round++) {
      const outId = randomUUID();
      await withTenant(app.db, A.tenantId, (tx) =>
        tx.insert(messages).values({
          tenantId: A.tenantId, conversationId, direction: "outbound", type: "text", body: "Hi",
          externalId: outId, status: "queued", author: "user",
        }),
      );
      const evs = await Promise.all(
        (["read", "delivered", "sent"] as const).map((st) => ingest(app, A.token, `status:${outId}:${st}`, statusPayload(outId, st))),
      );
      await Promise.all(evs.map((eventId) => processIngestStatus(deps, { eventId, tenantId: A.tenantId })));
      const [m] = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(messages).where(eq(messages.externalId, outId)));
      expect(m?.status).toBe("read");
    }
  });

  it("tenant A's message never shows up under withTenant(B)", async () => {
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000030"));
    const res = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    const seenByB = await withTenant(app.db, B.tenantId, (tx) =>
      tx.select().from(messages).where(eq(messages.id, res.messageId)),
    );
    expect(seenByB).toHaveLength(0);
    // A forged tenantId cannot read A's event either: unrecoverable, nothing written.
    const other = `wamid-${randomUUID()}`;
    const evA = await ingest(app, A.token, `msg:${other}`, textPayload(other, "5491100000031"));
    await expect(processIngestMessage(deps, { eventId: evA, tenantId: B.tenantId })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("forged tenantId writes nothing (no contact, no processed_at, no error)", async () => {
    const extId = `wamid-${randomUUID()}`;
    const phone = "5491100000050";
    const evA = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, phone));
    await expect(processIngestMessage(deps, { eventId: evA, tenantId: B.tenantId })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
    for (const t of [A, B]) {
      const cs = await withTenant(app.db, t.tenantId, (tx) =>
        tx.select().from(contacts).where(eq(contacts.phoneE164, `+${phone}`)),
      );
      expect(cs).toHaveLength(0);
    }
    const [ev] = await withTenant(app.db, A.tenantId, (tx) =>
      tx.select().from(inboundEvents).where(eq(inboundEvents.id, evA)),
    );
    expect(ev?.processedAt).toBeNull();
    expect(ev?.error).toBeNull();
  });

  it("same phone in two tenants, concurrently: one conversation per tenant, no cross-talk", async () => {
    const phone = "5491100000060";
    const jobs: Array<Promise<{ conversationId: string }>> = [];
    for (const t of [A, B]) {
      for (let i = 0; i < 5; i++) {
        const id = `wamid-${randomUUID()}`;
        const eventId = await ingest(app, t.token, `msg:${id}`, textPayload(id, phone));
        jobs.push(processIngestMessage(deps, { eventId, tenantId: t.tenantId }));
      }
    }
    const res = await Promise.all(jobs);
    const convA = new Set(res.slice(0, 5).map((r) => r.conversationId));
    const convB = new Set(res.slice(5).map((r) => r.conversationId));
    expect(convA.size).toBe(1);
    expect(convB.size).toBe(1);
    expect([...convA][0]).not.toBe([...convB][0]);
  });

  it("replay after the conversation was resolved does not open a new conversation", async () => {
    const extId = `wamid-${randomUUID()}`;
    const phone = "5491100000070";
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, phone));
    const first = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    await withTenant(app.db, A.tenantId, (tx) =>
      tx.update(conversations).set({ status: "resolved" }).where(eq(conversations.id, first.conversationId)),
    );
    const again = await processIngestMessage(deps, { eventId, tenantId: A.tenantId });
    expect(again).toEqual({ ...first, duplicate: true });
    const convs = await withTenant(app.db, A.tenantId, async (tx) => {
      const [c] = await tx.select().from(contacts).where(eq(contacts.phoneE164, `+${phone}`));
      return tx.select().from(conversations).where(eq(conversations.contactId, c?.id ?? ""));
    });
    expect(convs).toHaveLength(1);
  });

  it("a failing transaction leaves no partial rows", async () => {
    const extId = `wamid-${randomUUID()}`;
    const phone = "5491100000080";
    const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, phone));
    // Provider that yields an invalid message type: contact/conversation are written first,
    // then the message insert fails on the enum, so everything must roll back.
    const broken = {
      ...provider,
      parseWebhook: (body: unknown, h: Record<string, string>) =>
        provider.parseWebhook(body, h).map((r) =>
          r.kind === "message" ? { ...r, message: { ...r.message, type: "bogus" as never } } : r,
        ),
    } as unknown as GupshupProvider;
    await expect(processIngestMessage({ ...deps, provider: broken }, { eventId, tenantId: A.tenantId })).rejects.toThrow();
    await withTenant(app.db, A.tenantId, async (tx) => {
      expect(await tx.select().from(contacts).where(eq(contacts.phoneE164, `+${phone}`))).toHaveLength(0);
      expect(await tx.select().from(messages).where(eq(messages.externalId, extId))).toHaveLength(0);
      const [ev] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId));
      expect(ev?.processedAt).toBeNull();
    });
  });

  it("rejects invalid job data as unrecoverable", async () => {
    await expect(processIngestMessage(deps, { eventId: "x", tenantId: A.tenantId })).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it("publishes message.received on tenant:<id>:events", async () => {
    const sub = new Redis(REDIS_URL as string);
    const got = new Promise<string>((resolve) => sub.on("message", (_c, msg) => resolve(msg)));
    await sub.subscribe(tenantChannel(B.tenantId));
    const extId = `wamid-${randomUUID()}`;
    const eventId = await ingest(app, B.token, `msg:${extId}`, textPayload(extId, "5491100000040"));
    const res = await processIngestMessage(deps, { eventId, tenantId: B.tenantId });
    const msg = JSON.parse(await got) as unknown;
    expect(msg).toEqual({ type: "message.received", conversationId: res.conversationId, messageId: res.messageId });
    sub.disconnect();
  });
});
