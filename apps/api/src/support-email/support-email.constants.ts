import type { DbHandle } from "@crmwsp/db";

/** BullMQ queue consumed by apps/worker (keep in sync with apps/worker/src/support-email). */
export const SUPPORT_EMAIL_QUEUE_NAME = "support-email";
export const PROCESS_RESEND_EMAIL_JOB = "process-resend-email";

export const RESEND_EVENT_STORE = Symbol("RESEND_EVENT_STORE");
export const SUPPORT_EMAIL_QUEUE = Symbol("SUPPORT_EMAIL_QUEUE");
export const RESEND_WEBHOOK_SECRET = Symbol("RESEND_WEBHOOK_SECRET");

export interface SupportEmailQueue {
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
}

export interface ResendEventStore {
  ingest(dedupeKey: string, payload: unknown): Promise<{ eventId: string; inserted: boolean }>;
}

/** Inserts through the SECURITY DEFINER `ingest_resend_event` (tenant-less row). */
export class PgResendEventStore implements ResendEventStore {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async ingest(dedupeKey: string, payload: unknown): Promise<{ eventId: string; inserted: boolean }> {
    const rows = await this.sql<{ event_id: string; inserted: boolean }[]>`
      select event_id, inserted from public.ingest_resend_event(${dedupeKey}, ${JSON.stringify(payload ?? null)}::jsonb)`;
    const row = rows[0];
    if (!row) throw new Error("ingest_resend_event returned no row");
    return { eventId: row.event_id, inserted: row.inserted };
  }
}
