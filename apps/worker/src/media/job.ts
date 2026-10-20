import { attachments, isUuid, messages, withTenant, type Database } from "@crmwsp/db";
import { and, eq, isNull } from "drizzle-orm";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { MediaLoader } from "../ai/transcribe.js";
import type { Logger } from "../processors.js";
import type { MediaStore } from "./store.js";

export const MEDIA_QUEUE_NAME = "media";
export const STORE_MEDIA_JOB = "store-media";
export const STORE_MEDIA_MAX_ATTEMPTS = 5;
export const STORE_MEDIA_JOB_OPTIONS = {
  attempts: STORE_MEDIA_MAX_ATTEMPTS,
  backoff: { type: "exponential", delay: 5_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;
/** Larger inbound media is not persisted. */
export const MAX_STORED_MEDIA_BYTES = 50 * 1024 * 1024;

export interface StoreMediaJobData {
  tenantId: string;
  attachmentId: string;
}

/** BullMQ custom ids cannot contain a colon. One job per attachment keeps enqueueing idempotent. */
export const storeMediaJobId = (attachmentId: string): string => `store-media-${attachmentId}`;

export interface StoreMediaDeps {
  db: Database;
  store: MediaStore;
  loadMedia: MediaLoader;
  logger?: Logger;
}

export type StoreMediaResult =
  | { status: "stored"; storageKey: string; sizeBytes: number }
  | { status: "already_stored" | "skipped"; reason?: string };

const EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/opus": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "application/pdf": "pdf",
};

export function extensionForMime(mime: string): string {
  return EXT_BY_MIME[mime.toLowerCase().split(";")[0]?.trim() ?? ""] ?? "bin";
}

/** Deterministic key: a retried or duplicated job overwrites the same object. */
export const attachmentStorageKey = (tenantId: string, attachmentId: string, mime: string): string =>
  `tenants/${tenantId}/attachments/${attachmentId}.${extensionForMime(mime)}`;

function parseJobData(data: unknown): StoreMediaJobData {
  const d = data as Partial<StoreMediaJobData> | null;
  if (!d || typeof d.tenantId !== "string" || typeof d.attachmentId !== "string" || !isUuid(d.tenantId) || !isUuid(d.attachmentId)) {
    throw new UnrecoverableError("invalid store-media job data");
  }
  return { tenantId: d.tenantId, attachmentId: d.attachmentId };
}

/**
 * Downloads one inbound attachment and uploads it to object storage. No DB transaction is open
 * during network I/O: read row (tx), download + upload, then conditional update (tx).
 * Failures throw so BullMQ retries with backoff; storage_key stays null until success.
 */
export async function processStoreMedia(deps: StoreMediaDeps, data: unknown): Promise<StoreMediaResult> {
  const { tenantId, attachmentId } = parseJobData(data);
  const logger = deps.logger;

  const row = await withTenant(deps.db, tenantId, async (tx) => {
    const [r] = await tx
      .select({
        storageKey: attachments.storageKey,
        externalMediaId: attachments.externalMediaId,
        mimeType: attachments.mimeType,
        conversationId: messages.conversationId,
      })
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.messageId))
      .where(eq(attachments.id, attachmentId))
      .limit(1);
    return r;
  });
  if (!row) return { status: "skipped", reason: "attachment_not_found" };
  if (row.storageKey) return { status: "already_stored" };
  if (!row.externalMediaId) return { status: "skipped", reason: "no_external_media" };

  try {
    const media = await deps.loadMedia({
      tenantId,
      conversationId: row.conversationId,
      externalMediaId: row.externalMediaId,
      mimeType: row.mimeType,
    });
    if (media.data.byteLength === 0) throw new Error("empty media");
    if (media.data.byteLength > MAX_STORED_MEDIA_BYTES) {
      logger?.warn(`attachment ${attachmentId} too large to store`);
      return { status: "skipped", reason: "too_large" };
    }
    const mime = media.mimeType || row.mimeType || "application/octet-stream";
    const key = attachmentStorageKey(tenantId, attachmentId, mime);
    await deps.store.put(key, media.data, mime);
    const sizeBytes = media.data.byteLength;
    await withTenant(deps.db, tenantId, (tx) =>
      tx
        .update(attachments)
        .set({ storageKey: key, sizeBytes, mimeType: mime })
        .where(and(eq(attachments.id, attachmentId), isNull(attachments.storageKey))),
    );
    return { status: "stored", storageKey: key, sizeBytes };
  } catch (err) {
    // Class name only: BSP and S3 errors may embed URLs or credentials.
    logger?.warn(`store-media ${attachmentId} failed (${err instanceof Error ? err.name : "unknown"})`);
    throw err;
  }
}

export interface MediaWorkerOptions extends StoreMediaDeps {
  connection: ConnectionOptions;
  queueName?: string;
  concurrency?: number;
}

export function createMediaWorker(opts: MediaWorkerOptions): Worker {
  const { connection, queueName = MEDIA_QUEUE_NAME, concurrency = 3, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== STORE_MEDIA_JOB) throw new UnrecoverableError("unknown job name");
      return processStoreMedia(deps, job.data);
    },
    { connection, concurrency },
  );
}
