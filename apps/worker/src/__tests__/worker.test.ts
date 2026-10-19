import { randomUUID } from "node:crypto";
import { inboundEvents, messages, withTenant, type DbHandle } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { Queue, QueueEvents } from "bullmq";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRedis, INGEST_MESSAGE_JOB } from "../queue.js";
import { createInboundWorker } from "../worker.js";
import { APP_URL, MIGRATOR_URL, REDIS_URL, createDb, dropTenants, hasEnv, ingest, seedTenants, textPayload, type SeedTenant } from "./helpers.js";

describe.skipIf(!hasEnv)("inbound BullMQ worker", () => {
  const queueName = `inbound-test-${randomUUID()}`;
  let migrator: DbHandle;
  let app: DbHandle;
  let A: SeedTenant;
  let queue: Queue;

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string);
    [A] = (await seedTenants(migrator, 1)) as [SeedTenant];
    queue = new Queue(queueName, { connection: createRedis(REDIS_URL as string) });
  });

  afterAll(async () => {
    await queue?.obliterate({ force: true });
    await queue?.close();
    if (migrator) {
      await dropTenants(migrator, A ? [A.tenantId] : []);
      await migrator.close();
    }
    await app?.close();
  });

  it("processes ingest-message jobs and records unrecoverable errors without retrying", async () => {
    const connection = createRedis(REDIS_URL as string);
    const publisher = createRedis(REDIS_URL as string);
    const events = new QueueEvents(queueName, { connection: createRedis(REDIS_URL as string) });
    await events.waitUntilReady();
    const worker = createInboundWorker({
      connection,
      queueName,
      concurrency: 2,
      db: app.db,
      provider: new GupshupProvider(),
      publisher,
    });
    try {
      const extId = `wamid-${randomUUID()}`;
      const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000099"));
      const ok = await queue.add(INGEST_MESSAGE_JOB, { eventId, tenantId: A.tenantId }, { jobId: eventId, attempts: 5 });
      await ok.waitUntilFinished(events, 10_000);

      // Event whose payload does not contain a message for its dedupe key -> UnrecoverableError.
      const badEvent = await ingest(app, A.token, `msg:nope-${randomUUID()}`, textPayload(`x-${randomUUID()}`));
      const bad = await queue.add(
        INGEST_MESSAGE_JOB,
        { eventId: badEvent, tenantId: A.tenantId },
        { jobId: badEvent, attempts: 5, backoff: { type: "exponential", delay: 10 } },
      );
      await expect(bad.waitUntilFinished(events, 10_000)).rejects.toThrow();
      const failed = await queue.getJob(badEvent);
      expect(failed?.attemptsMade).toBe(1);
      const [row] = await withTenant(app.db, A.tenantId, (tx) =>
        tx.select().from(inboundEvents).where(eq(inboundEvents.id, badEvent)),
      );
      expect(row?.error).toMatch(/^unrecoverable:/);
      expect(row?.processedAt).toBeNull();
    } finally {
      await worker.close();
      await events.close();
      connection.disconnect();
      publisher.disconnect();
    }
  });
  it("jobId dedupes against completed jobs; after removal a re-add reprocesses idempotently", async () => {
    const connection = createRedis(REDIS_URL as string);
    const publisher = createRedis(REDIS_URL as string);
    const events = new QueueEvents(queueName, { connection: createRedis(REDIS_URL as string) });
    await events.waitUntilReady();
    const worker = createInboundWorker({ connection, queueName, db: app.db, provider: new GupshupProvider(), publisher });
    try {
      const extId = `wamid-${randomUUID()}`;
      const eventId = await ingest(app, A.token, `msg:${extId}`, textPayload(extId, "5491100000098"));
      const data = { eventId, tenantId: A.tenantId };
      const first = await queue.add(INGEST_MESSAGE_JOB, data, { jobId: eventId });
      const r1 = (await first.waitUntilFinished(events, 10_000)) as { duplicate: boolean };
      expect(r1.duplicate).toBe(false);
      // Completed job still in the completed set: add() with the same jobId is a no-op.
      const again = await queue.add(INGEST_MESSAGE_JOB, data, { jobId: eventId });
      expect(again.id).toBe(eventId);
      expect(await again.getState()).toBe("completed");
      expect((await queue.getJob(eventId))?.returnvalue).toEqual(r1);
      // removeOnComplete dropped it: a re-add runs again but is idempotent.
      await (await queue.getJob(eventId))?.remove();
      const third = await queue.add(INGEST_MESSAGE_JOB, data, { jobId: eventId });
      const r3 = (await third.waitUntilFinished(events, 10_000)) as { duplicate: boolean; messageId: string };
      expect(r3).toEqual({ ...r1, duplicate: true });
      const rows = await withTenant(app.db, A.tenantId, (tx) => tx.select().from(messages).where(eq(messages.externalId, extId)));
      expect(rows).toHaveLength(1);
    } finally {
      await worker.close();
      await events.close();
      connection.disconnect();
      publisher.disconnect();
    }
  });
});
