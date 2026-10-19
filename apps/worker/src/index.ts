import { pathToFileURL } from "node:url";
import { createCipherBox, loadMasterKeysFromEnv } from "@crmwsp/crypto";
import { createDb } from "@crmwsp/db";
import { GupshupProvider } from "@crmwsp/whatsapp";
import { createRedis } from "./queue.js";
import { createInboundWorker } from "./worker.js";
import { createOutboundWorker } from "./outbound.js";

export * from "./queue.js";
export * from "./processors.js";
export * from "./status.js";
export * from "./outbound.js";
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

  const worker = createInboundWorker({
    connection,
    concurrency: Number.isInteger(concurrency) && concurrency > 0 ? concurrency : 5,
    db: db.db,
    provider: new GupshupProvider(),
    publisher,
    logger,
  });
  worker.on("failed", (job, err) =>
    logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
  );

  // Outbound sends need the master keys to decrypt BSP credentials. Without them the
  // inbound worker still runs; send-message jobs wait in the queue.
  let outbound: ReturnType<typeof createOutboundWorker> | undefined;
  try {
    const keys = loadMasterKeysFromEnv(process.env);
    outbound = createOutboundWorker({
      connection: createRedis(redisUrl),
      concurrency: 5,
      db: db.db,
      provider: new GupshupProvider(),
      publisher,
      cipher: createCipherBox(keys),
      logger,
    });
    outbound.on("failed", (job, err) =>
      logger.warn(`job ${job?.name ?? "?"} ${job?.id ?? "?"} failed (${err.name}), attempt ${job?.attemptsMade ?? 0}`),
    );
  } catch (err) {
    logger.warn(`outbound worker disabled: ${err instanceof Error ? err.message : "master keys unavailable"}`);
  }

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    // worker.close() waits for in-flight jobs to finish.
    void Promise.allSettled([worker.close(), outbound?.close()])
      .then(() => Promise.allSettled([db.close(), connection.quit(), publisher.quit()]))
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
