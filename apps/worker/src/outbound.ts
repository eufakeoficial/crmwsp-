import type { CipherBox } from "@crmwsp/crypto";
import {
  broadcastRecipients,
  broadcasts,
  channelConnections,
  contacts,
  conversations,
  followUps,
  isUuid,
  messages,
  messageTemplates,
  withTenant,
  type Database,
} from "@crmwsp/db";
import type { SendResult, WhatsAppConnection, WhatsAppProvider } from "@crmwsp/whatsapp";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from "bullmq";
import { and, eq, sql } from "drizzle-orm";
import { tenantChannel, type EventPublisher, type InboxEvent, type Logger } from "./processors.js";
import {
  OUTBOUND_QUEUE_NAME,
  SEND_MESSAGE_JOB,
  SEND_MESSAGE_MAX_ATTEMPTS,
  type SendMessageJobData,
} from "./queue.js";

/** AAD purpose of the encrypted Gupshup API key (same as apps/api channels). */
export const GUPSHUP_API_KEY_PURPOSE = "gupshup_api_key";

export interface SendDeps {
  db: Database;
  provider: WhatsAppProvider;
  publisher: EventPublisher;
  cipher: CipherBox;
  logger?: Logger;
}

export interface SendAttempt {
  /** Attempts already made before this one (BullMQ job.attemptsMade). */
  attemptsMade: number;
  maxAttempts: number;
}

export type SendMessageResult =
  | { outcome: "sent"; externalId: string }
  | { outcome: "skipped"; reason: "already-sent" | "not-queued" | "locked" }
  | { outcome: "failed" };

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function assertSendData(data: unknown): SendMessageJobData {
  const d = data as Partial<SendMessageJobData> | null;
  if (!d || !isUuid(d.tenantId) || !isUuid(d.messageId)) throw new UnrecoverableError("invalid job data");
  return { tenantId: d.tenantId, messageId: d.messageId };
}

/** Provider errors expose `retryable`; anything else is treated as transient (DB, Redis). */
function isRetryable(err: unknown): boolean {
  const r = (err as { retryable?: unknown } | null)?.retryable;
  if (typeof r === "boolean") return r;
  if (err instanceof UnrecoverableError) return false;
  if ((err as { name?: unknown } | null)?.name === "DecryptionError") return false;
  return true;
}

/** Persistable error: provider messages are fixed strings without request data. */
function sanitizeError(err: unknown): Record<string, unknown> {
  const e = err as { name?: unknown; status?: unknown; message?: unknown; provider?: unknown } | null;
  if (e && e.provider === "gupshup" && typeof e.message === "string") {
    return { code: "provider_error", message: e.message.slice(0, 200), ...(typeof e.status === "number" ? { status: e.status } : {}) };
  }
  if (e?.name === "DecryptionError") return { code: "credentials_unavailable" };
  if (err instanceof UnrecoverableError) return { code: "unrecoverable", message: err.message.slice(0, 200) };
  return { code: "internal_error" };
}

/** Template resolved for a type='template' message (via follow_ups.sent_message_id). */
export interface OutboundTemplate {
  externalId: string | null;
  name: string;
  language: string;
  status: string;
  variables: unknown[];
}

export interface OutboundPayload {
  type: string;
  body: string | null;
  contactName: string | null;
  template: OutboundTemplate | null;
  /** Pre-resolved template params (broadcast recipients); otherwise derived from `template.variables`. */
  params?: string[] | null;
}

/** Fills template params from the variable names stored on message_templates.variables. */
export function resolveTemplateParams(variables: unknown[], ctx: { contactName: string | null }): string[] {
  return variables.map((v) => {
    if (v === "name" || v === "contact_name") {
      if (!ctx.contactName) throw new UnrecoverableError("template variable has no value");
      return ctx.contactName;
    }
    throw new UnrecoverableError("unsupported template variable");
  });
}

/** Picks the provider call for a message: approved templates go through sendTemplate, the rest as text. */
export async function dispatchOutbound(
  provider: WhatsAppProvider,
  conn: WhatsAppConnection,
  to: string,
  msg: OutboundPayload,
): Promise<SendResult> {
  if (msg.type === "template") {
    const t = msg.template;
    if (!t) throw new UnrecoverableError("template message without template");
    if (t.status !== "approved") throw new UnrecoverableError("template is not approved");
    if (!t.externalId) throw new UnrecoverableError("template has no external id");
    const params = msg.params ?? resolveTemplateParams(Array.isArray(t.variables) ? t.variables : [], { contactName: msg.contactName });
    return provider.sendTemplate(conn, to, t.externalId, params);
  }
  if (!msg.body) throw new UnrecoverableError("message has no text");
  return provider.sendText(conn, to, msg.body);
}

async function publish(deps: SendDeps, tenantId: string, event: InboxEvent): Promise<void> {
  try {
    await deps.publisher.publish(tenantChannel(tenantId), JSON.stringify(event));
  } catch (err) {
    (deps.logger ?? silent).warn(`publish failed (${err instanceof Error ? err.name : "unknown"})`);
  }
}

/**
 * Sends one queued outbound message through the BSP. Idempotent: a message that
 * already has an external_id (or is no longer queued) is never re-sent. The text
 * and the API key are never logged.
 */
export async function processSendMessage(
  deps: SendDeps,
  data: unknown,
  attempt: SendAttempt = { attemptsMade: 0, maxAttempts: SEND_MESSAGE_MAX_ATTEMPTS },
): Promise<SendMessageResult> {
  const { tenantId, messageId } = assertSendData(data);

  // One transaction per attempt. The message row is locked with FOR UPDATE SKIP LOCKED
  // for the whole send: a second worker processing the same job concurrently (e.g. a
  // stalled-job re-run) skips it instead of calling the BSP again.
  const result = await withTenant(deps.db, tenantId, async (tx) => {
    const [loaded] = await tx
      .select({
        status: messages.status,
        type: messages.type,
        direction: messages.direction,
        body: messages.body,
        externalId: messages.externalId,
        conversationId: messages.conversationId,
        to: contacts.phoneE164,
        contactName: contacts.name,
        tplExternalId: messageTemplates.externalId,
        tplName: messageTemplates.name,
        tplLanguage: messageTemplates.language,
        tplStatus: messageTemplates.status,
        tplVariables: messageTemplates.variables,
        connectionId: channelConnections.id,
        sourcePhone: channelConnections.phoneE164,
        appName: channelConnections.externalAppId,
        connectionStatus: channelConnections.status,
        credentials: channelConnections.credentialsEncrypted,
        recipientId: broadcastRecipients.id,
        recipientParams: broadcastRecipients.params,
        broadcastStatus: broadcasts.status,
      })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(contacts, eq(contacts.id, conversations.contactId))
      .innerJoin(channelConnections, eq(channelConnections.id, conversations.channelConnectionId))
      // Template messages come from follow-ups: follow_ups.sent_message_id -> message, template_id -> template.
      .leftJoin(followUps, eq(followUps.sentMessageId, messages.id))
      // Broadcast messages: broadcast_recipients.message_id -> message, broadcasts.template_id -> template.
      .leftJoin(broadcastRecipients, eq(broadcastRecipients.messageId, messages.id))
      .leftJoin(broadcasts, eq(broadcasts.id, broadcastRecipients.broadcastId))
      .leftJoin(
        messageTemplates,
        and(
          eq(messageTemplates.id, sql`coalesce(${followUps.templateId}, ${broadcasts.templateId})`),
          eq(messageTemplates.channelConnectionId, channelConnections.id),
        ),
      )
      .where(eq(messages.id, messageId))
      .limit(1)
      .for("update", { of: messages, skipLocked: true });
    if (!loaded) {
      // Either RLS hides it (forged tenantId) or another worker holds the lock.
      const [exists] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.id, messageId));
      if (!exists) throw new UnrecoverableError("message not found");
      return { res: { outcome: "skipped", reason: "locked" } as SendMessageResult };
    }
    if (loaded.externalId) return { res: { outcome: "skipped", reason: "already-sent" } as SendMessageResult };
    if (loaded.status !== "queued" || loaded.direction !== "outbound") {
      return { res: { outcome: "skipped", reason: "not-queued" } as SendMessageResult };
    }

    try {
      if (loaded.broadcastStatus === "cancelled") throw new UnrecoverableError("broadcast cancelled");
      if (loaded.connectionStatus === "disabled") throw new UnrecoverableError("channel is disabled");
      if (!loaded.credentials || !loaded.appName) throw new UnrecoverableError("channel has no credentials");
      const apiKey = deps.cipher.decrypt(loaded.credentials, { tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
      const { externalId } = await dispatchOutbound(
        deps.provider,
        { apiKey, appName: loaded.appName, sourcePhone: loaded.sourcePhone },
        loaded.to,
        {
          type: loaded.type,
          body: loaded.body,
          contactName: loaded.contactName,
          params: loaded.recipientId ? (loaded.recipientParams ?? []) : null,
          template:
            loaded.tplName !== null
              ? {
                  externalId: loaded.tplExternalId,
                  name: loaded.tplName,
                  language: loaded.tplLanguage ?? "",
                  status: loaded.tplStatus ?? "",
                  variables: loaded.tplVariables ?? [],
                }
              : null,
        },
      );
      await tx
        .update(messages)
        .set({ externalId, status: "sent", sentAt: new Date(), error: null })
        .where(and(eq(messages.id, messageId), eq(messages.status, "queued")));
      if (loaded.recipientId) {
        await tx
          .update(broadcastRecipients)
          .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
          .where(and(eq(broadcastRecipients.id, loaded.recipientId), eq(broadcastRecipients.status, "pending")));
      }
      return { res: { outcome: "sent", externalId } as SendMessageResult, conversationId: loaded.conversationId };
    } catch (err) {
      const lastAttempt = attempt.attemptsMade + 1 >= attempt.maxAttempts;
      if (isRetryable(err) && !lastAttempt) {
        (deps.logger ?? silent).warn(`send-message ${messageId} transient failure (attempt ${attempt.attemptsMade + 1})`);
        throw err; // rolls back; BullMQ retries
      }
      await tx
        .update(messages)
        .set({ status: "failed", error: sanitizeError(err) })
        .where(and(eq(messages.id, messageId), eq(messages.status, "queued")));
      if (loaded.recipientId) {
        const cancelled = loaded.broadcastStatus === "cancelled";
        await tx
          .update(broadcastRecipients)
          .set({ status: cancelled ? "skipped" : "failed", error: sanitizeError(err), updatedAt: new Date() })
          .where(and(eq(broadcastRecipients.id, loaded.recipientId), eq(broadcastRecipients.status, "pending")));
      }
      (deps.logger ?? silent).warn(`send-message ${messageId} failed permanently`);
      return { res: { outcome: "failed" } as SendMessageResult, conversationId: loaded.conversationId };
    }
  });
  if (result.conversationId) {
    await publish(deps, tenantId, { type: "message.status", conversationId: result.conversationId, messageId });
  }
  return result.res;
}

export interface OutboundWorkerOptions extends SendDeps {
  connection: ConnectionOptions;
  queueName?: string;
  concurrency?: number;
}

export function createOutboundWorker(opts: OutboundWorkerOptions): Worker {
  const { connection, queueName = OUTBOUND_QUEUE_NAME, concurrency = 5, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== SEND_MESSAGE_JOB) throw new UnrecoverableError("unknown job name");
      return processSendMessage(deps, job.data, {
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts ?? 1,
      });
    },
    { connection, concurrency },
  );
}
