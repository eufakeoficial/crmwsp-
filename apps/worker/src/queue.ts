import { Queue } from "bullmq";
import { Redis } from "ioredis";

export const INBOUND_QUEUE_NAME = "inbound";
export const INGEST_MESSAGE_JOB = "ingest-message";
export const INGEST_STATUS_JOB = "ingest-status";

export interface InboundJobData {
  eventId: string;
  tenantId: string;
}

export function createRedis(redisUrl: string): Redis {
  // BullMQ requires maxRetriesPerRequest = null on worker connections.
  return new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: true });
}

// BullMQ 6 needs an explicit ioredis client under native ESM; lazyConnect keeps
// construction side-effect free until the queue issues its first command.
export function createInboundQueue(redisUrl: string, name: string = INBOUND_QUEUE_NAME): Queue {
  return new Queue(name, { connection: createRedis(redisUrl) });
}
