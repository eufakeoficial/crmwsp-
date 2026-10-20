import { ElevenLabsTTSProvider } from "@crmwsp/ai";
import { pathToFileURL } from "node:url";
import { createCipherBox, loadMasterKeysFromEnv } from "@crmwsp/crypto";
import { createDb } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { Queue } from "bullmq";
import { createAiWorker, createBspMediaLoader } from "./ai/index.js";
import { AI_QUEUE_NAME, OUTBOUND_QUEUE_NAME, createRedis } from "./queue.js";
import { createInboundWorker } from "./worker.js";
import { createOutboundWorker } from "./outbound.js";
import { FOLLOW_UP_QUEUE_NAME, createFollowUpWorker, scheduleFollowUpTick } from "./followups/index.js";
import { MEDIA_QUEUE_NAME, createMediaWorker, mediaStoreFromEnv } from "./media/index.js";
import { NOTIFICATION_QUEUE_NAME, createNotificationWorker, scheduleNotificationTick } from "./notifications/index.js";

export * from "./queue.js";
export * from "./processors.js";
export * from "./status.js";
export * from "./outbound.js";
export * from "./ai/index.js";
export * from "./followups/index.js";
export * from "./notifications/index.js";
export * from "./media/index.js";
export { createInboundWorker } from "./worker.js";
export type { InboundWorkerOptions } from "./worker.js";

const logger = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
};

function main(): void {
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const databaseUrl = process.env["DATABASE_URL"];
  if (!databaseUrl) {
    console.error("worker: DATABASE_URL is not set");
    process.exit(1);
  }
  const concurrency = Number(process.env["INBOUND_CONCURRENCY"] ?? 5);
  const db = createDb(databaseUrl);
  const connection = createRedis(redisUrl);
  const publisher = createRedis(redisUrl);

  // Producer for AI turns scheduled by ingest (the API enqueues embed-source / execute-ai-action).
  const aiQueue = new Queue(AI_QUEUE_NAME, { connection: createRedis(redisUrl) });

  // Producer for store-media jobs (inbound media copied to S3); disabled when S3_* is not configured.
  const mediaStore = mediaStoreFromEnv();
  const mediaQueue = mediaStore ? new Queue(MEDIA_QUEUE_NAME, { connection: createRedis(redisUrl) }) : undefined;

  const worker = createInboundWorker({
    connection,
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 5,
    db: db.db,
    provider: new GupshupProvider(),
    publisher,
    aiQueue,
    ...(mediaQueue ? { mediaQueue } : {}),
    logger,
  });
  worker.on("failed", (job, err) =>
    logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
  );

  // Outbound sends need the master keys to decrypt BSP credentials. Without them the
  // inbound worker still runs; send-message jobs wait in the queue.
  let outbound: ReturnType<typeof createOutboundWorker> | undefined;
  let ai: ReturnType<typeof createAiWorker> | undefined;
  let outboundQueue: Queue | undefined;
  let lockRedis: ReturnType<typeof createRedis> | undefined;
  let followUps: ReturnType<typeof createFollowUpWorker> | undefined;
  let followUpQueue: Queue | undefined;
  let notificationsWorker: ReturnType<typeof createNotificationWorker> | undefined;
  let notificationQueue: Queue | undefined;
  let mediaWorker: ReturnType<typeof createMediaWorker> | undefined;
  try {
    const keys = loadMasterKeysFromEnv(process.env);
    const cipher = createCipherBox(keys);
    outbound = createOutboundWorker({
      connection: createRedis(redisUrl),
      concurrency: 5,
      db: db.db,
      provider: new GupshupProvider(),
      publisher,
      cipher,
      logger,
      ...(mediaStore ? { voice: { tts: new ElevenLabsTTSProvider(), store: mediaStore } } : {}),
    });
    outboundQueue = new Queue(OUTBOUND_QUEUE_NAME, { connection: createRedis(redisUrl) });
    // AI jobs also need the master keys (BYOK LLM keys are encrypted).
    lockRedis = createRedis(redisUrl);
    const aiConcurrency = Number(process.env["AI_CONCURRENCY"] ?? 3);
    ai = createAiWorker({
      connection: createRedis(redisUrl),
      concurrency: Number.isInteger(aiConcurrency) && aiConcurrency > 0 ? aiConcurrency : 3,
      db: db.db,
      publisher,
      cipher,
      outboundQueue,
      lockRedis,
      loadMedia: createBspMediaLoader({ db: db.db, cipher, provider: new GupshupProvider(), store: mediaStore }),
      logger,
    });
    if (mediaStore) {
      mediaWorker = createMediaWorker({
        connection: createRedis(redisUrl),
        db: db.db,
        store: mediaStore,
        loadMedia: createBspMediaLoader({ db: db.db, cipher, provider: new GupshupProvider() }),
        logger,
      });
      mediaWorker.on("failed", (job, err) =>
        logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
      );
    }
    ai.on("failed", (job, err) =>
      logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
    );
    // Follow-up scheduler: only enqueues onto the outbound queue, so it runs with it.
    followUpQueue = new Queue(FOLLOW_UP_QUEUE_NAME, { connection: createRedis(redisUrl) });
    followUps = createFollowUpWorker({ connection: createRedis(redisUrl), db: db.db, outboundQueue, logger });
    void scheduleFollowUpTick(followUpQueue).catch((err: unknown) =>
      logger.warn(`follow-up scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Owner notifications: SSE fan-out + optional owner WhatsApp through the outbound queue.
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, { connection: createRedis(redisUrl) });
    notificationsWorker = createNotificationWorker({ connection: createRedis(redisUrl), db: db.db, publisher, outboundQueue, logger });
    void scheduleNotificationTick(notificationQueue).catch((err: unknown) =>
      logger.warn(`notification scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    outbound.on("failed", (job, err) =>
      logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
    );
  } catch (err) {
    logger.warn(`outbound and ai workers disabled: ${err instanceof Error ? err.message : "master keys unavailable"}`);
  }

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    // worker.close() waits for in-flight jobs to finish.
    void Promise.allSettled([worker.close(), outbound?.close(), ai?.close(), followUps?.close(), notificationsWorker?.close(), mediaWorker?.close()])
      .then(() => Promise.allSettled([aiQueue.close(), outboundQueue?.close(), followUpQueue?.close(), notificationQueue?.close(), mediaQueue?.close()]))
      .then(() => Promise.allSettled([db.close(), connection.quit(), publisher.quit(), lockRedis?.quit()]))
      .finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  logger.info("worker ready");
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main();
}
