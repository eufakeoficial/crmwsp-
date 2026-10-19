import { pathToFileURL } from "node:url";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const INBOUND_QUEUE_NAME = "inbound";

// BullMQ 6 needs an explicit ioredis client under native ESM; lazyConnect keeps
// construction side-effect free until the queue issues its first command.
export function createInboundQueue(redisUrl: string): Queue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
  return new Queue(INBOUND_QUEUE_NAME, { connection });
}

function main(): void {
  const redisUrl = process.env["REDIS_URL"] ?? "redis://localhost:6379";
  const inboundQueue = createInboundQueue(redisUrl);

  const shutdown = (): void => {
    void inboundQueue.close().finally(() => process.exit(0));
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  console.log("worker ready");
}

const entrypoint = process.argv[1];
if (entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href) {
  main();
}
