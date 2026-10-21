import {
  consents,
  conversations,
  followUps,
  messageTemplates,
  messages,
  orders,
  type Transaction,
} from "@crmwsp/db";
import { leadStalledKey, orderPendingKey, type ConsentState } from "@crmwsp/domain";
import type { FollowUpSettings } from "@crmwsp/contracts";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { DueFollowUp, FollowUpStore } from "./engine.js";

/** Postgres adapter of FollowUpStore; `tx` must come from withTenant (RLS scopes every query). */
export function createPgFollowUpStore(tx: Transaction, tenantId: string): FollowUpStore {
  return {
    async lockDue(now, limit) {
      const rows = await tx
        .select({
          id: followUps.id,
          conversationId: followUps.conversationId,
          status: followUps.status,
          scheduledAt: followUps.scheduledAt,
          createdAt: followUps.createdAt,
          messageBody: followUps.messageBody,
          templateId: followUps.templateId,
          orderId: followUps.orderId,
        })
        .from(followUps)
        .where(
          and(
            eq(followUps.status, "scheduled"),
            lte(followUps.scheduledAt, now),
            // Paused contacts (T23): deferred, not cancelled; sent on a tick after the pause.
            sql`not exists (select 1 from conversations pc join contacts pct on pct.id = pc.contact_id
              where pc.id = ${followUps.conversationId} and pct.automations_paused_until > ${now.toISOString()}::timestamptz)`,
          ),
        )
        .orderBy(followUps.scheduledAt)
        .limit(limit)
        .for("update", { skipLocked: true });
      const out: DueFollowUp[] = [];
      for (const r of rows) {
        const [c] = await tx
          .select({
            lastInboundAt: conversations.lastInboundAt,
            status: conversations.status,
            contactId: conversations.contactId,
            channelConnectionId: conversations.channelConnectionId,
          })
          .from(conversations)
          .where(eq(conversations.id, r.conversationId));
        if (!c) continue; // cascade-deleted concurrently
        const [consent] = await tx
          .select({ status: consents.status })
          .from(consents)
          .where(and(eq(consents.contactId, c.contactId), eq(consents.kind, "follow_up")));
        let approvedTemplate: DueFollowUp["approvedTemplate"] = null;
        if (r.templateId) {
          const [t] = await tx
            .select({ id: messageTemplates.id, body: messageTemplates.body })
            .from(messageTemplates)
            .where(
              and(
                eq(messageTemplates.id, r.templateId),
                eq(messageTemplates.status, "approved"),
                eq(messageTemplates.channelConnectionId, c.channelConnectionId),
              ),
            );
          approvedTemplate = t ?? null;
        }
        let orderStatus: string | null = null;
        if (r.orderId) {
          const [o] = await tx.select({ status: orders.status }).from(orders).where(eq(orders.id, r.orderId));
          orderStatus = o?.status ?? "deleted";
        }
        out.push({
          id: r.id,
          conversationId: r.conversationId,
          status: r.status,
          scheduledAt: r.scheduledAt,
          createdAt: r.createdAt,
          messageBody: r.messageBody,
          templateId: r.templateId,
          lastInboundAt: c.lastInboundAt,
          conversationResolved: c.status === "resolved",
          consent: (consent?.status ?? "unknown") as ConsentState,
          approvedTemplate,
          orderStatus,
        });
      }
      return out;
    },

    async insertQueuedMessage(f, kind, body) {
      // client_message_id = follow-up id: messages_tenant_client_message_id_unique makes this idempotent.
      const [ins] = await tx
        .insert(messages)
        .values({
          tenantId,
          conversationId: f.conversationId,
          direction: "outbound",
          type: kind,
          body,
          status: "queued",
          author: "system",
          clientMessageId: f.id,
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning({ id: messages.id });
      if (ins) {
        await tx
          .update(conversations)
          .set({ lastMessageAt: new Date(), updatedAt: new Date() })
          .where(eq(conversations.id, f.conversationId));
        return ins.id;
      }
      const [existing] = await tx.select({ id: messages.id }).from(messages).where(eq(messages.clientMessageId, f.id));
      if (!existing) throw new Error("follow-up message conflict without row");
      return existing.id;
    },

    async markSent(id, messageId, templateId, now) {
      await tx
        .update(followUps)
        .set({
          status: "sent",
          sentMessageId: messageId,
          requiresTemplate: templateId !== null,
          ...(templateId ? { templateId } : {}),
          consentCheckedAt: now,
          updatedAt: now,
        })
        .where(and(eq(followUps.id, id), eq(followUps.status, "scheduled")));
    },
    async markSkipped(id, reason, now) {
      await tx
        .update(followUps)
        .set({ status: "skipped", skipReason: reason, consentCheckedAt: now, updatedAt: now })
        .where(and(eq(followUps.id, id), eq(followUps.status, "scheduled")));
    },
    async markCancelled(id, reason, now) {
      await tx
        .update(followUps)
        .set({ status: "cancelled", skipReason: reason, updatedAt: now })
        .where(and(eq(followUps.id, id), eq(followUps.status, "scheduled")));
    },
    async defer(id, until, now) {
      await tx
        .update(followUps)
        .set({ scheduledAt: until, updatedAt: now })
        .where(and(eq(followUps.id, id), eq(followUps.status, "scheduled")));
    },
  };
}

/** Rule look-back beyond the delay, so enabling a rule does not backfill old conversations. */
const LOOKBACK_HOURS = 48;

/**
 * Creates automatic follow-ups from the tenant rules. Idempotent: one row per dedupe key
 * (triggering message / order), and never when the conversation already has a pending one.
 */
export async function createRuleFollowUps(tx: Transaction, s: FollowUpSettings): Promise<number> {
  let created = 0;
  const lead = s.leadStalled;
  if (lead.enabled) {
    const delay = `${lead.delayHours} hours`;
    const lookback = `${lead.delayHours + LOOKBACK_HOURS} hours`;
    const rows = await tx.execute(sql`
      insert into follow_ups (tenant_id, conversation_id, rule, dedupe_key, reason, message_body, template_id, scheduled_at, status)
      select c.tenant_id, c.id, 'lead_stalled', ${leadStalledKey("")} || m.id::text,
             ${`No reply from the contact ${lead.delayHours}h after our last message`},
             ${lead.message}, ${lead.templateId}::uuid, now(), 'scheduled'
      from conversations c
      join lateral (
        select lm.id, lm.author, lm.created_at from messages lm
        where lm.conversation_id = c.id order by lm.created_at desc limit 1
      ) m on true
      where c.status <> 'resolved'
        and c.last_inbound_at is not null
        and m.author in ('ai', 'user')
        and m.created_at > c.last_inbound_at
        and m.created_at <= now() - ${delay}::interval
        and m.created_at > now() - ${lookback}::interval
        and not exists (
          select 1 from follow_ups f where f.conversation_id = c.id and f.status in ('suggested', 'scheduled')
        )
      on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
      returning id`);
    created += rows.length;
  }
  const ord = s.orderPendingPayment;
  if (ord.enabled) {
    const delay = `${ord.delayHours} hours`;
    const lookback = `${ord.delayHours + 7 * 24} hours`;
    // orders has no "pending since" column; updated_at is the last state change (approximation).
    const rows = await tx.execute(sql`
      insert into follow_ups (tenant_id, conversation_id, order_id, rule, dedupe_key, reason, message_body, template_id, scheduled_at, status)
      select o.tenant_id, o.conversation_id, o.id, 'order_pending_payment', ${orderPendingKey("")} || o.id::text,
             ${`Order still pending payment after ${ord.delayHours}h`} || ' (' || o.number || ')',
             ${ord.message}, ${ord.templateId}::uuid, now(), 'scheduled'
      from orders o
      where o.status = 'pending_payment'
        and o.conversation_id is not null
        and o.updated_at <= now() - ${delay}::interval
        and o.updated_at > now() - ${lookback}::interval
        and not exists (
          select 1 from follow_ups f where f.order_id = o.id and f.status in ('suggested', 'scheduled')
        )
      on conflict (tenant_id, dedupe_key) where dedupe_key is not null do nothing
      returning id`);
    created += rows.length;
  }
  return created;
}

/** Cancels pending follow-ups of a conversation (the contact replied). Call inside withTenant. */
export async function cancelFollowUpsForConversation(tx: Transaction, conversationId: string, reason = "contact_replied"): Promise<number> {
  const rows = await tx
    .update(followUps)
    .set({ status: "cancelled", skipReason: reason, updatedAt: new Date() })
    .where(and(eq(followUps.conversationId, conversationId), inArray(followUps.status, ["suggested", "scheduled"])))
    .returning({ id: followUps.id });
  return rows.length;
}

/** Cancels pending follow-ups of an order (it was paid / cancelled). Call inside withTenant. */
export async function cancelFollowUpsForOrder(tx: Transaction, orderId: string, reason = "order_paid"): Promise<number> {
  const rows = await tx
    .update(followUps)
    .set({ status: "cancelled", skipReason: reason, updatedAt: new Date() })
    .where(and(eq(followUps.orderId, orderId), inArray(followUps.status, ["suggested", "scheduled"])))
    .returning({ id: followUps.id });
  return rows.length;
}
