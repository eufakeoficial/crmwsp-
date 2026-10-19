import {
  attachments,
  contacts,
  conversations,
  inboundEvents,
  isUuid,
  messages,
  withTenant,
  type Database,
  type Transaction,
} from "@crmwsp/db";
import type { InboundWebhookResult, NormalizedInboundMessage, WhatsAppProvider } from "@crmwsp/whatsapp";
import { UnrecoverableError } from "bullmq";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { InboundJobData } from "./queue.js";
import { previousStatusesFor } from "./status.js";

/** Minimal publisher (ioredis satisfies it). */
export interface EventPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface ProcessorDeps {
  db: Database;
  provider: WhatsAppProvider;
  publisher: EventPublisher;
  logger?: Logger;
}

export type InboxEventType = "message.received" | "message.status";

export interface InboxEvent {
  type: InboxEventType;
  conversationId: string;
  messageId: string;
}

export interface IngestMessageResult {
  conversationId: string;
  messageId: string;
  duplicate: boolean;
}

export interface IngestStatusResult {
  updated: boolean;
  messageId?: string;
  conversationId?: string;
}

export const tenantChannel = (tenantId: string): string => `tenant:${tenantId}:events`;

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function assertJobData(data: unknown): InboundJobData {
  const d = data as Partial<InboundJobData> | null;
  if (!d || !isUuid(d.eventId) || !isUuid(d.tenantId)) {
    throw new UnrecoverableError("invalid job data");
  }
  return { eventId: d.eventId, tenantId: d.tenantId };
}

async function loadResult<K extends "message" | "status">(
  tx: Transaction,
  provider: WhatsAppProvider,
  eventId: string,
  kind: K,
): Promise<{ event: typeof inboundEvents.$inferSelect; result: Extract<InboundWebhookResult, { kind: K }> }> {
  // RLS restricts the read to the job's tenant: a forged tenantId simply finds nothing.
  const [event] = await tx.select().from(inboundEvents).where(eq(inboundEvents.id, eventId)).limit(1);
  if (!event) throw new UnrecoverableError("inbound event not found");
  const result = provider
    .parseWebhook(event.payload, {})
    .find((r): r is Extract<InboundWebhookResult, { kind: K }> => r.kind === kind && r.dedupeKey === event.dedupeKey);
  if (!result) throw new UnrecoverableError(`inbound event has no ${kind} for its dedupe key`);
  return { event, result };
}

async function markProcessed(tx: Transaction, eventId: string): Promise<void> {
  await tx.update(inboundEvents).set({ processedAt: new Date(), error: null }).where(eq(inboundEvents.id, eventId));
}

function messageBody(m: NormalizedInboundMessage): string | null {
  if (m.text !== undefined) return m.text;
  if (m.media?.caption !== undefined) return m.media.caption;
  if (m.location) {
    const { latitude, longitude, name, address } = m.location;
    return [name, address, `${latitude},${longitude}`].filter(Boolean).join(" — ");
  }
  return null;
}

async function publish(deps: ProcessorDeps, tenantId: string, event: InboxEvent): Promise<void> {
  try {
    await deps.publisher.publish(tenantChannel(tenantId), JSON.stringify(event));
  } catch (err) {
    // Realtime is best effort: the data is committed; the inbox can refetch.
    (deps.logger ?? silent).warn(`publish failed (${err instanceof Error ? err.name : "unknown"})`);
  }
}

/** Ingests one inbound WhatsApp message. Idempotent: replays never duplicate rows. */
export async function processIngestMessage(deps: ProcessorDeps, data: unknown): Promise<IngestMessageResult> {
  const { eventId, tenantId } = assertJobData(data);

  const out = await withTenant(deps.db, tenantId, async (tx) => {
    const { event, result } = await loadResult(tx, deps.provider, eventId, "message");
    const m = result.message;
    const connectionId = event.channelConnectionId;
    if (!connectionId) throw new UnrecoverableError("inbound event has no channel connection");
    const now = new Date();

    // Replay of an already ingested message (e.g. BullMQ removed the completed job and the BSP
    // retried): return before touching contacts/conversations, so a replay after the
    // conversation was resolved does not open a new, empty conversation.
    const [already] = await tx
      .select({ id: messages.id, conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.externalId, m.externalId))
      .limit(1);
    if (already) {
      await markProcessed(tx, eventId);
      return { conversationId: already.conversationId, messageId: already.id, duplicate: true };
    }

    const [contact] = await tx
      .insert(contacts)
      .values({ tenantId, phoneE164: m.from, ...(m.contactName ? { name: m.contactName } : {}) })
      .onConflictDoUpdate({
        target: [contacts.tenantId, contacts.phoneE164],
        set: {
          name: sql`coalesce(excluded.name, ${contacts.name})`,
          updatedAt: now,
        },
      })
      .returning({ id: contacts.id });
    if (!contact) throw new Error("contact upsert returned no row");

    // Serialise conversation creation per (tenant, contact, connection): concurrent messages
    // from the same contact would otherwise race on conversations_one_unresolved_unique.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${contact.id}:${connectionId}`}, 0))`,
    );
    const where = and(
      eq(conversations.contactId, contact.id),
      eq(conversations.channelConnectionId, connectionId),
      ne(conversations.status, "resolved"),
    );
    let [conversation] = await tx.select({ id: conversations.id }).from(conversations).where(where).limit(1);
    if (!conversation) {
      [conversation] = await tx
        .insert(conversations)
        .values({ tenantId, contactId: contact.id, channelConnectionId: connectionId })
        .returning({ id: conversations.id });
    }
    if (!conversation) throw new Error("conversation upsert returned no row");

    const [inserted] = await tx
      .insert(messages)
      .values({
        tenantId,
        conversationId: conversation.id,
        direction: "inbound",
        type: m.type,
        body: messageBody(m),
        externalId: m.externalId,
        status: "received",
        author: "contact",
        sentAt: m.timestamp,
      })
      .onConflictDoNothing({
        target: [messages.tenantId, messages.externalId],
        where: sql`${messages.externalId} is not null`,
      })
      .returning({ id: messages.id, conversationId: messages.conversationId });

    if (!inserted) {
      // Duplicate delivery (unique (tenant_id, external_id)): idempotent success.
      const [existing] = await tx
        .select({ id: messages.id, conversationId: messages.conversationId })
        .from(messages)
        .where(eq(messages.externalId, m.externalId))
        .limit(1);
      if (!existing) throw new Error("duplicate message not found");
      await markProcessed(tx, eventId);
      return { conversationId: existing.conversationId, messageId: existing.id, duplicate: true };
    }

    if (m.media) {
      // TODO: download media (provider.downloadMedia) to object storage and fill storage_key/size.
      await tx.insert(attachments).values({
        tenantId,
        messageId: inserted.id,
        externalMediaId: m.media.externalMediaId ?? m.media.url ?? null,
        mimeType: m.media.mimeType ?? null,
      });
    }

    const ts = m.timestamp.toISOString();
    await tx
      .update(conversations)
      .set({
        lastInboundAt: sql`greatest(coalesce(${conversations.lastInboundAt}, ${ts}::timestamptz), ${ts}::timestamptz)`,
        lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${ts}::timestamptz), ${ts}::timestamptz)`,
        updatedAt: now,
      })
      .where(eq(conversations.id, conversation.id));

    await markProcessed(tx, eventId);
    return { conversationId: conversation.id, messageId: inserted.id, duplicate: false };
  });

  if (!out.duplicate) {
    await publish(deps, tenantId, {
      type: "message.received",
      conversationId: out.conversationId,
      messageId: out.messageId,
    });
  }
  return out;
}

/** Applies a delivery status, only when it moves the message forward. */
export async function processIngestStatus(deps: ProcessorDeps, data: unknown): Promise<IngestStatusResult> {
  const { eventId, tenantId } = assertJobData(data);
  const logger = deps.logger ?? silent;

  const out = await withTenant(deps.db, tenantId, async (tx): Promise<IngestStatusResult> => {
    const { result } = await loadResult(tx, deps.provider, eventId, "status");
    const s = result.status;
    const allowed = previousStatusesFor(s.status);
    let updated: { id: string; conversationId: string } | undefined;
    if (allowed.length > 0) {
      [updated] = await tx
        .update(messages)
        .set({
          status: s.status,
          ...(s.status === "failed" && s.error ? { error: { code: s.error.code, message: s.error.message } } : {}),
        })
        .where(and(eq(messages.externalId, s.externalId), inArray(messages.status, allowed)))
        .returning({ id: messages.id, conversationId: messages.conversationId });
    }
    if (!updated) {
      const [exists] = await tx
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.externalId, s.externalId))
        .limit(1);
      if (!exists) {
        // Status arrived before (or without) the outbound message row: nothing to update.
        logger.warn(`status ${s.status} for unknown message (event ${eventId})`);
      }
    }
    await markProcessed(tx, eventId);
    return updated ? { updated: true, messageId: updated.id, conversationId: updated.conversationId } : { updated: false };
  });

  if (out.updated && out.messageId && out.conversationId) {
    await publish(deps, tenantId, {
      type: "message.status",
      conversationId: out.conversationId,
      messageId: out.messageId,
    });
  }
  return out;
}

/** Error text safe to persist: never driver messages (drizzle embeds query params there). */
export function safeErrorText(err: unknown): string {
  if (err instanceof UnrecoverableError) return `unrecoverable: ${err.message}`.slice(0, 500);
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  const name = typeof e?.name === "string" ? e.name : "Error";
  return typeof code === "string" ? `${name} (pg ${code})` : name;
}

/** Records the failure on inbound_events.error (own transaction; the failed one rolled back). */
export async function recordFailure(db: Database, data: unknown, err: unknown): Promise<void> {
  const d = data as Partial<InboundJobData> | null;
  if (!d || !isUuid(d.tenantId) || !isUuid(d.eventId)) return;
  const eventId = d.eventId;
  await withTenant(db, d.tenantId, (tx) =>
    tx.update(inboundEvents).set({ error: safeErrorText(err) }).where(eq(inboundEvents.id, eventId)),
  );
}
