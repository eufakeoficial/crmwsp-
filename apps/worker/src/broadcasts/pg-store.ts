import {
  broadcastRecipients,
  broadcasts,
  consents,
  conversations,
  messages,
  messageTemplates,
  type Transaction,
} from "@crmwsp/db";
import { and, asc, eq, gt, isNull, lte, ne, sql } from "drizzle-orm";
import type { BroadcastStore, PendingRecipient, SendingBroadcast } from "./engine.js";

/** Postgres adapter of the broadcast engine; every call runs inside the tenant's transaction. */
export function createPgBroadcastStore(tx: Transaction, tenantId: string): BroadcastStore {
  return {
    async promoteDue(now) {
      const rows = await tx
        .update(broadcasts)
        .set({ status: "sending", startedAt: now, updatedAt: now })
        .where(and(eq(broadcasts.status, "scheduled"), lte(broadcasts.scheduledAt, now)))
        .returning({ id: broadcasts.id });
      return rows.length;
    },

    async listSending(): Promise<SendingBroadcast[]> {
      return tx
        .select({ id: broadcasts.id, channelConnectionId: broadcasts.channelConnectionId, templateBody: messageTemplates.body })
        .from(broadcasts)
        .innerJoin(messageTemplates, eq(messageTemplates.id, broadcasts.templateId))
        .where(eq(broadcasts.status, "sending"))
        .orderBy(asc(broadcasts.startedAt), asc(broadcasts.id));
    },

    async lockPending(broadcastId, limit): Promise<PendingRecipient[]> {
      const rows = await tx
        .select({
          id: broadcastRecipients.id,
          contactId: broadcastRecipients.contactId,
          params: broadcastRecipients.params,
          consent: consents.status,
        })
        .from(broadcastRecipients)
        .leftJoin(consents, and(eq(consents.contactId, broadcastRecipients.contactId), eq(consents.kind, "marketing")))
        .where(
          and(
            eq(broadcastRecipients.broadcastId, broadcastId),
            eq(broadcastRecipients.status, "pending"),
            isNull(broadcastRecipients.messageId),
          ),
        )
        .orderBy(asc(broadcastRecipients.createdAt), asc(broadcastRecipients.id))
        .limit(limit)
        .for("update", { of: broadcastRecipients, skipLocked: true });
      return rows.map((r) => ({ id: r.id, contactId: r.contactId, params: r.params, marketingConsent: r.consent ?? null }));
    },

    async createMessage(b, r, body) {
      // Same per-(tenant, contact, connection) lock as inbound ingest: no duplicate open conversation.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${tenantId}:${r.contactId}:${b.channelConnectionId}`}, 0))`);
      let [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(
          and(
            eq(conversations.contactId, r.contactId),
            eq(conversations.channelConnectionId, b.channelConnectionId),
            ne(conversations.status, "resolved"),
          ),
        )
        .limit(1);
      if (!conv) {
        [conv] = await tx
          .insert(conversations)
          .values({ tenantId, contactId: r.contactId, channelConnectionId: b.channelConnectionId })
          .returning({ id: conversations.id });
      }
      if (!conv) throw new Error("conversation insert returned no row");
      const now = new Date();
      const [msg] = await tx
        .insert(messages)
        .values({ tenantId, conversationId: conv.id, direction: "outbound", type: "template", body, status: "queued", author: "system" })
        .returning({ id: messages.id });
      if (!msg) throw new Error("message insert returned no row");
      await tx
        .update(broadcastRecipients)
        .set({ messageId: msg.id, updatedAt: now })
        .where(and(eq(broadcastRecipients.id, r.id), isNull(broadcastRecipients.messageId)));
      await tx.update(conversations).set({ lastMessageAt: now, updatedAt: now }).where(eq(conversations.id, conv.id));
      return msg.id;
    },

    async markSkipped(recipientId, code) {
      await tx
        .update(broadcastRecipients)
        .set({ status: "skipped", error: { code }, updatedAt: new Date() })
        .where(and(eq(broadcastRecipients.id, recipientId), eq(broadcastRecipients.status, "pending")));
    },

    async countPending(broadcastId) {
      const [r] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(broadcastRecipients)
        .where(and(eq(broadcastRecipients.broadcastId, broadcastId), eq(broadcastRecipients.status, "pending")));
      return r?.n ?? 0;
    },

    async markCompleted(broadcastId, now) {
      await tx
        .update(broadcasts)
        .set({ status: "completed", completedAt: now, updatedAt: now })
        .where(and(eq(broadcasts.id, broadcastId), eq(broadcasts.status, "sending")));
    },
  };
}

/** Broadcast messages still queued (enqueue lost after a previous commit), for re-enqueue. */
export async function staleBroadcastMessages(tx: Transaction, now: Date, limit = 200): Promise<string[]> {
  const rows = await tx
    .select({ id: messages.id })
    .from(broadcastRecipients)
    .innerJoin(messages, eq(messages.id, broadcastRecipients.messageId))
    .innerJoin(broadcasts, eq(broadcasts.id, broadcastRecipients.broadcastId))
    .where(
      and(
        eq(broadcasts.status, "sending"),
        eq(broadcastRecipients.status, "pending"),
        eq(messages.status, "queued"),
        gt(messages.createdAt, new Date(now.getTime() - 3600_000)),
      ),
    )
    .limit(limit);
  return rows.map((r) => r.id);
}

