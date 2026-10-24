import { ElevenLabsTTSProvider } from "@crmwsp/ai";
import { pathToFileURL } from "node:url";
import { parsePdf } from "@crmwsp/knowledge";
import { createCipherBox, loadMasterKeysFromEnv } from "@crmwsp/crypto";
import { createDb } from "@crmwsp/db";
import { createDefaultWhatsAppProvider } from "@crmwsp/whatsapp";
import { Queue } from "bullmq";
import { createAiWorker, createBspMediaLoader } from "./ai/index.js";
import { AI_QUEUE_NAME, OUTBOUND_QUEUE_NAME, createRedis } from "./queue.js";
import { createInboundWorker } from "./worker.js";
import { createOutboundWorker } from "./outbound.js";
import { FOLLOW_UP_QUEUE_NAME, createFollowUpWorker, scheduleFollowUpTick } from "./followups/index.js";
import { CAPI_QUEUE_NAME, createCapiWorker, scheduleCapiTick, type FetchLike } from "./meta-capi/index.js";
import { META_ADS_QUEUE_NAME, createMetaAdsWorker, scheduleMetaAdsTick, type MetaGetFetch } from "./meta-ads/index.js";
import { BROADCAST_QUEUE_NAME, createBroadcastWorker, scheduleBroadcastTick } from "./broadcasts/index.js";
import { TEMPLATE_SYNC_QUEUE_NAME, createTemplateSyncWorker, scheduleTemplateSyncTick } from "./templates/index.js";
import { MEDIA_QUEUE_NAME, createMediaWorker, mediaStoreFromEnv } from "./media/index.js";
import { createMailerFromEnv, emailContextFromEnv, siteLink, templateMessage } from "@crmwsp/mailer";
import { NOTIFICATION_QUEUE_NAME, createNotificationWorker, scheduleNotificationTick } from "./notifications/index.js";
import { OWNER_MODE_QUEUE_NAME, createOwnerInterpreter, createOwnerModeWorker, createOwnerSender } from "./owner-mode/index.js";
import { WEBHOOK_QUEUE_NAME, createWebhookSender, createWebhookWorker, scheduleWebhookTick } from "./webhooks/index.js";
import { ORDER_EXTRACTION_QUEUE_NAME, createOrderExtractionWorker } from "./order-extraction/index.js";
import { NowPaymentsProvider, nowPaymentsOptionsFromEnv } from "@crmwsp/payments";
import {
  SUBSCRIPTION_BILLING_QUEUE_NAME,
  createSubscriptionBillingWorker,
  scheduleSubscriptionReconcileTick,
} from "./subscription-billing/index.js";

export * from "./queue.js";
export * from "./processors.js";
export * from "./status.js";
export * from "./outbound.js";
export * from "./ai/index.js";
export * from "./followups/index.js";
export * from "./meta-capi/index.js";
export * from "./meta-ads/index.js";
export * from "./templates/index.js";
export * from "./notifications/index.js";
export * from "./media/index.js";
export * from "./webhooks/index.js";
export * from "./broadcasts/index.js";
export * from "./owner-mode/index.js";
export * from "./order-extraction/index.js";
export * from "./subscription-billing/index.js";
export { createInboundWorker } from "./worker.js";
export type { InboundWorkerOptions } from "./worker.js";

const logger = {
  info: (m: string) => console.log(m),
  warn: (m: string) => console.warn(m),
  error: (m: string) => console.error(m),
};

function main(): void {
  // CN-011: dev allowances need an explicit NODE_ENV; unset/unknown runs as production.
  const nodeEnv = process.env["NODE_ENV"];
  if (!nodeEnv) logger.error("worker: NODE_ENV is not set; running with production security defaults");
  const devOrTest = nodeEnv === "development" || nodeEnv === "test";
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
  // Producer for F4 order detection on inbound voice notes, photos and PDFs.
  const orderExtractionQueue = new Queue(ORDER_EXTRACTION_QUEUE_NAME, { connection: createRedis(redisUrl) });

  // Producer for owner-mode commands (F9): inbound from verified owner phones.
  const ownerQueue = new Queue(OWNER_MODE_QUEUE_NAME, { connection: createRedis(redisUrl) });

  const worker = createInboundWorker({
    connection,
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 5,
    db: db.db,
    provider: createDefaultWhatsAppProvider(),
    publisher,
    aiQueue,
    ownerQueue,
    ...(mediaQueue ? { mediaQueue } : {}),
    orderExtractionQueue,
    logger,
  });
  worker.on("failed", (job, err) =>
    logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
  );

  // SaaS subscription settlement (NOWPayments, ADR 0013): needs no master keys. Without
  // NOWPAYMENTS_API_KEY, IPN settlement still runs and the reconciliation tick is a no-op.
  const nowPaymentsOptions = nowPaymentsOptionsFromEnv(process.env);
  const subscriptionQueue = new Queue(SUBSCRIPTION_BILLING_QUEUE_NAME, { connection: createRedis(redisUrl) });
  const subscriptionWorker = createSubscriptionBillingWorker({
    connection: createRedis(redisUrl),
    db: db.db,
    provider: nowPaymentsOptions ? new NowPaymentsProvider(nowPaymentsOptions) : null,
    logger,
    ...(process.env.TRIAL_IDENTITY_SECRET ? { trialIdentitySecret: process.env.TRIAL_IDENTITY_SECRET } : {}),
    lifecycleEmails: { send: (m) => createMailerFromEnv().send(m), ctx: emailContextFromEnv() },
    sendSetupReminder: async (r) => {
      const days = Math.max(1, Math.ceil((r.setupEndsAt.getTime() - Date.now()) / 86_400_000));
      const ctx = emailContextFromEnv();
      await createMailerFromEnv().send(
        templateMessage(r.ownerEmail, "recordatorio-conecta-whatsapp", { tenantName: r.tenantName, days, connectUrl: siteLink(ctx, "/app/channels") }, ctx),
      );
    },
  });
  subscriptionWorker.on("failed", (job, err) =>
    logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
  );
  // Always scheduled: without NOWPayments the reconcile part is a no-op, but the plan sync and the
  // setup reminders (ADR 0015) still run.
  {
    void scheduleSubscriptionReconcileTick(subscriptionQueue).catch((err: unknown) =>
      logger.warn(`subscription reconcile scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
  }

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
  let capiWorker: ReturnType<typeof createCapiWorker> | undefined;
  let capiQueue: Queue | undefined;
  let metaAdsWorker: ReturnType<typeof createMetaAdsWorker> | undefined;
  let metaAdsQueue: Queue | undefined;
  let templateSyncWorker: ReturnType<typeof createTemplateSyncWorker> | undefined;
  let templateSyncQueue: Queue | undefined;
  let webhooksWorker: ReturnType<typeof createWebhookWorker> | undefined;
  let webhookQueue: Queue | undefined;
  let broadcastWorker: ReturnType<typeof createBroadcastWorker> | undefined;
  let broadcastQueue: Queue | undefined;
  let ownerWorker: ReturnType<typeof createOwnerModeWorker> | undefined;
  let orderExtractionWorker: ReturnType<typeof createOrderExtractionWorker> | undefined;
  try {
    const keys = loadMasterKeysFromEnv(process.env);
    const cipher = createCipherBox(keys);
    outbound = createOutboundWorker({
      connection: createRedis(redisUrl),
      concurrency: 5,
      db: db.db,
      provider: createDefaultWhatsAppProvider(),
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
      loadMedia: createBspMediaLoader({ db: db.db, cipher, provider: createDefaultWhatsAppProvider(), store: mediaStore }),
      logger,
    });
    // F4: order detection on voice notes, photos and PDFs (PDF text via @crmwsp/knowledge).
    orderExtractionWorker = createOrderExtractionWorker({
      connection: createRedis(redisUrl),
      db: db.db,
      cipher,
      publisher,
      outboundQueue,
      aiQueue,
      pdfText: async (bytes) => (await parsePdf(bytes)).text,
      loadMedia: createBspMediaLoader({ db: db.db, cipher, provider: createDefaultWhatsAppProvider(), store: mediaStore }),
      logger,
    });
    orderExtractionWorker.on("failed", (job, err) =>
      logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
    );
    if (mediaStore) {
      mediaWorker = createMediaWorker({
        connection: createRedis(redisUrl),
        db: db.db,
        store: mediaStore,
        loadMedia: createBspMediaLoader({ db: db.db, cipher, provider: createDefaultWhatsAppProvider() }),
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
    // Broadcast campaigns: rate-limited batches onto the outbound queue.
    broadcastQueue = new Queue(BROADCAST_QUEUE_NAME, { connection: createRedis(redisUrl) });
    broadcastWorker = createBroadcastWorker({ connection: createRedis(redisUrl), db: db.db, outboundQueue, logger });
    void scheduleBroadcastTick(broadcastQueue).catch((err: unknown) =>
      logger.warn(`broadcast scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Owner notifications: SSE fan-out + optional owner WhatsApp through the outbound queue.
    notificationQueue = new Queue(NOTIFICATION_QUEUE_NAME, { connection: createRedis(redisUrl) });
    const mailer = createMailerFromEnv();
    notificationsWorker = createNotificationWorker({
      connection: createRedis(redisUrl),
      db: db.db,
      publisher,
      outboundQueue,
      sendOwnerText: createOwnerSender({ db: db.db, provider: createDefaultWhatsAppProvider(), cipher }),
      sendOwnerEmail: async (msg) => {
        if (!msg.to) return;
        const ctx = emailContextFromEnv();
        await mailer.send(templateMessage(msg.to, "notificacion-generica", { title: msg.title, body: msg.body ?? "", appUrl: siteLink(ctx, "/app") }, ctx));
      },
      logger,
    });
    void scheduleNotificationTick(notificationQueue).catch((err: unknown) =>
      logger.warn(`notification scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Meta Conversions API (Lead / Purchase of Click-to-WhatsApp contacts); tokens need the master keys.
    const capiFetch: FetchLike = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });
    capiQueue = new Queue(CAPI_QUEUE_NAME, { connection: createRedis(redisUrl) });
    capiWorker = createCapiWorker({ connection: createRedis(redisUrl), db: db.db, cipher, fetch: capiFetch, logger });
    void scheduleCapiTick(capiQueue).catch((err: unknown) =>
      logger.warn(`capi scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Meta Marketing API spend sync (every 6 h + "Sincronizar ahora" from the api); token needs the master keys.
    const metaAdsFetch: MetaGetFetch = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
    metaAdsQueue = new Queue(META_ADS_QUEUE_NAME, { connection: createRedis(redisUrl) });
    metaAdsWorker = createMetaAdsWorker({ connection: createRedis(redisUrl), db: db.db, cipher, fetch: metaAdsFetch, logger });
    void scheduleMetaAdsTick(metaAdsQueue).catch((err: unknown) =>
      logger.warn(`meta ads scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // WhatsApp template review status sync (every 15 min); channel API keys need the master keys.
    templateSyncQueue = new Queue(TEMPLATE_SYNC_QUEUE_NAME, { connection: createRedis(redisUrl) });
    templateSyncWorker = createTemplateSyncWorker({ connection: createRedis(redisUrl), db: db.db, cipher, provider: createDefaultWhatsAppProvider(), logger });
    void scheduleTemplateSyncTick(templateSyncQueue).catch((err: unknown) =>
      logger.warn(`template sync scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Outbound tenant webhooks (signed with the decrypted endpoint secret). http:// only outside production.
    webhookQueue = new Queue(WEBHOOK_QUEUE_NAME, { connection: createRedis(redisUrl) });
    webhooksWorker = createWebhookWorker({
      connection: createRedis(redisUrl),
      db: db.db,
      cipher,
      send: createWebhookSender({ allowHttp: devOrTest }),
      logger,
    });
    void scheduleWebhookTick(webhookQueue).catch((err: unknown) =>
      logger.warn(`webhook scheduler not registered (${err instanceof Error ? err.name : "unknown"})`),
    );
    // Owner mode (F9): replies through the tenant channel; LLM key and BSP key need the master keys.
    ownerWorker = createOwnerModeWorker({
      connection: createRedis(redisUrl),
      db: db.db,
      send: createOwnerSender({ db: db.db, provider: createDefaultWhatsAppProvider(), cipher }),
      interpret: createOwnerInterpreter({ db: db.db, cipher, logger }),
      aiQueue,
      outboundQueue,
      logger,
    });
    ownerWorker.on("failed", (job, err) =>
      logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
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
    void Promise.allSettled([worker.close(), subscriptionWorker.close(), subscriptionQueue.close(), outbound?.close(), ai?.close(), followUps?.close(), notificationsWorker?.close(), mediaWorker?.close(), capiWorker?.close(), metaAdsWorker?.close(), templateSyncWorker?.close(), webhooksWorker?.close(), broadcastWorker?.close(), ownerWorker?.close(), orderExtractionWorker?.close()])
      .then(() => Promise.allSettled([aiQueue.close(), outboundQueue?.close(), followUpQueue?.close(), notificationQueue?.close(), mediaQueue?.close(), capiQueue?.close(), metaAdsQueue?.close(), templateSyncQueue?.close(), webhookQueue?.close(), broadcastQueue?.close(), ownerQueue.close(), orderExtractionQueue.close()]))
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
