import { isUuid, sql, type Database } from "@crmwsp/db";
import {
  EMAIL_HTML_MAX,
  EMAIL_TEXT_MAX,
  autoMailReason,
  headerMap,
  htmlToText,
  normalizeSubject,
  parseAddress,
  parseMessageIds,
  sanitizeEmailHtml,
  ticketNumberFromSubject,
} from "@crmwsp/domain";
import { PLATFORM_INBOX_ADDRESS, ResendApiError, type ResendReceivedEmail, type ResendReceivingClient } from "@crmwsp/mailer";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { Logger } from "../processors.js";

/** Keep in sync with apps/api/src/support-email/support-email.constants.ts. */
export const SUPPORT_EMAIL_QUEUE_NAME = "support-email";
export const PROCESS_RESEND_EMAIL_JOB = "process-resend-email";
/** Platform realtime channel (apps/api RealtimeHub PLATFORM_SUPPORT_CHANNEL). */
export const PLATFORM_SUPPORT_CHANNEL = "platform:support:events";

export interface SupportEmailDeps {
  db: Database;
  /** Null when RESEND_API_KEY is unset: events stay unprocessed (retried) until configured. */
  resend: Pick<ResendReceivingClient, "getReceivedEmail"> | null;
  publisher: { publish(channel: string, message: string): Promise<unknown> };
  logger?: Logger;
}

export type SupportEmailOutcome = "stored" | "duplicate" | "rate_limited" | "ignored" | "already_processed" | "invalid";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

interface IngestInput {
  resendEmailId: string;
  messageId: string | null;
  refs: string[];
  fromEmail: string;
  fromName: string | null;
  to: string[];
  subject: string;
  subjectNorm: string;
  ticketNumber: number | null;
  text: string;
  html: string | null;
  attachments: { id: string; emailId: string; filename: string; contentType: string; size: number | null }[];
  autoReason: string | null;
}

/** Pure mapping from Resend's received email to the ingest arguments (unit-tested). */
export function toIngestInput(email: ResendReceivedEmail): IngestInput | null {
  const from = parseAddress(email.from);
  if (!from) return null;
  const headers = headerMap(email.headers);
  const html = email.html ? sanitizeEmailHtml(email.html, EMAIL_HTML_MAX) : null;
  const text = (email.text?.trim() || (html ? htmlToText(html) : "")).slice(0, EMAIL_TEXT_MAX);
  const messageId = parseMessageIds(email.messageId ?? headers.get("message-id") ?? null)[0] ?? null;
  const refs = [...parseMessageIds(headers.get("in-reply-to") ?? null), ...parseMessageIds(headers.get("references") ?? null)].slice(0, 50);
  const to = email.to
    .map((t) => parseAddress(t)?.email)
    .filter((t): t is string => Boolean(t))
    .slice(0, 50);
  return {
    resendEmailId: email.id,
    messageId,
    refs: [...new Set(refs)],
    fromEmail: from.email,
    fromName: from.name,
    to,
    subject: email.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 250),
    subjectNorm: normalizeSubject(email.subject),
    ticketNumber: ticketNumberFromSubject(email.subject),
    text,
    html,
    attachments: email.attachments.slice(0, 50).map((a) => ({ ...a, emailId: email.id })),
    autoReason: autoMailReason(headers, from.email),
  };
}

/** Fetches the email body from Resend and stores it as a ticket message. Never replies. */
export async function processResendEmail(deps: SupportEmailDeps, data: unknown): Promise<SupportEmailOutcome> {
  const log = deps.logger ?? silent;
  const d = data as { eventId?: unknown } | null;
  if (!d || !isUuid(d.eventId)) throw new UnrecoverableError("invalid job data");
  const eventId = d.eventId;
  const [event] = await deps.db.execute<{ payload: { data?: { email_id?: unknown; from?: unknown } } | null; processed_at: Date | null }>(
    sql`select payload, processed_at from public.resend_event_get(${eventId}::uuid)`,
  );
  if (!event) throw new UnrecoverableError("resend event not found");
  if (event.processed_at) return "already_processed";
  const mark = (error: string | null) => deps.db.execute(sql`select public.resend_event_mark(${eventId}::uuid, ${error})`);

  const emailId = event.payload?.data?.email_id;
  if (typeof emailId !== "string") {
    await mark("invalid_payload");
    return "invalid";
  }
  // Mail we sent ourselves (loops through forwarding) is never ingested.
  const webhookFrom = parseAddress(typeof event.payload?.data?.from === "string" ? event.payload.data.from : null);
  if (webhookFrom?.email === PLATFORM_INBOX_ADDRESS) {
    await mark("self_sent");
    return "ignored";
  }
  if (!deps.resend) throw new Error("RESEND_API_KEY not configured");

  let email: ResendReceivedEmail;
  try {
    email = await deps.resend.getReceivedEmail(emailId);
  } catch (err) {
    if (err instanceof ResendApiError && err.status === 404) {
      await mark("not_found");
      return "invalid";
    }
    throw err; // transient: BullMQ retries with backoff
  }
  const input = toIngestInput(email);
  if (!input || input.fromEmail === PLATFORM_INBOX_ADDRESS) {
    await mark(input ? "self_sent" : "invalid_sender");
    return input ? "ignored" : "invalid";
  }

  const [row] = await deps.db.execute<{ ticket_id: string | null; outcome: SupportEmailOutcome }>(sql`
    select ticket_id, outcome from public.support_email_ingest(
      ${input.resendEmailId}, ${input.messageId}, ${input.refs}::text[], ${input.fromEmail}, ${input.fromName},
      ${input.to}::text[], ${input.subject}, ${input.subjectNorm}, ${input.ticketNumber}::integer, ${input.text},
      ${input.html}, ${JSON.stringify(input.attachments)}::jsonb, ${input.autoReason})`);
  const outcome = row?.outcome ?? "invalid";
  await mark(outcome === "stored" ? null : outcome);
  if (outcome === "stored" && row?.ticket_id) {
    try {
      await deps.publisher.publish(PLATFORM_SUPPORT_CHANNEL, JSON.stringify({ type: "support.ticket_updated", ticketId: row.ticket_id }));
    } catch {
      // Best effort: the inbox refetches on focus.
    }
  }
  if (outcome === "rate_limited") log.warn(`support email from a rate-limited sender dropped (event ${eventId})`);
  return outcome;
}

export interface SupportEmailWorkerOptions extends SupportEmailDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

export function createSupportEmailWorker(opts: SupportEmailWorkerOptions): Worker {
  const { connection, queueName = SUPPORT_EMAIL_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name === PROCESS_RESEND_EMAIL_JOB) return processResendEmail(deps, job.data);
      throw new UnrecoverableError("unknown job name");
    },
    { connection, concurrency: 2 },
  );
}
