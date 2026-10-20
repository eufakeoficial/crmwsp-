import { resolveInboxSettings, type InboxSettings } from "@crmwsp/contracts";
import { contacts, conversations, tenants, type Transaction } from "@crmwsp/db";
import { automationsPaused, pickRoundRobinAssignee } from "@crmwsp/domain";
import { and, desc, eq, isNotNull, ne, sql } from "drizzle-orm";

/** Inbox v2 routing (T23): folder open/closed on inbound and handoff, round-robin assignment. */

export async function loadInboxSettings(tx: Transaction, tenantId: string): Promise<InboxSettings> {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return resolveInboxSettings(t?.settings?.["inbox"]);
}

export async function contactAutomationsPaused(tx: Transaction, contactId: string, now: Date): Promise<boolean> {
  const [ct] = await tx
    .select({ until: contacts.automationsPausedUntil })
    .from(contacts)
    .where(eq(contacts.id, contactId));
  return automationsPaused(ct?.until ?? null, now);
}

/**
 * Round robin among agents (falls back to admins/owners when the tenant has no agent): least
 * open chats below the cap, then longest since the last assignment. Serialised per tenant.
 * Returns the chosen user id (null when nobody is eligible) and writes the assignment.
 */
export async function autoAssign(
  tx: Transaction,
  tenantId: string,
  conversationId: string,
  settings: InboxSettings,
  now: Date,
): Promise<string | null> {
  if (settings.autoAssign !== "round_robin") return null;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`inbox-rr:${tenantId}`}, 0))`);
  const rows = await tx.execute<{ user_id: string; role: string; open_count: number; last_assigned_at: Date | string | null }>(sql`
    select m.user_id, m.role::text as role,
           (select count(*)::int from conversations c
             where c.assigned_user_id = m.user_id and c.inbox_status = 'open' and c.id <> ${conversationId}::uuid) as open_count,
           (select max(c.assigned_at) from conversations c where c.assigned_user_id = m.user_id) as last_assigned_at
    from memberships m where m.role <> 'viewer'`);
  const agents = rows.filter((r) => r.role === "agent");
  const pool = agents.length > 0 ? agents : rows;
  const userId = pickRoundRobinAssignee(
    pool.map((r) => ({
      userId: r.user_id,
      openCount: Number(r.open_count),
      lastAssignedAt: r.last_assigned_at ? new Date(r.last_assigned_at) : null,
    })),
    settings.maxOpenPerAgent,
  );
  if (!userId) return null;
  const updated = await tx
    .update(conversations)
    .set({ assignedUserId: userId, assignedAt: now, lockVersion: sql`${conversations.lockVersion} + 1`, updatedAt: now })
    .where(and(eq(conversations.id, conversationId), sql`${conversations.assignedUserId} is null`))
    .returning({ id: conversations.id });
  return updated.length > 0 ? userId : null;
}

/**
 * Previous agent of the contact on this channel (a resolved conversation that the contact
 * reopened by writing again goes back to the same agent), if still a member.
 */
export async function previousAssignee(
  tx: Transaction,
  contactId: string,
  channelConnectionId: string,
  exceptConversationId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ userId: conversations.assignedUserId })
    .from(conversations)
    .where(
      and(
        eq(conversations.contactId, contactId),
        eq(conversations.channelConnectionId, channelConnectionId),
        ne(conversations.id, exceptConversationId),
        isNotNull(conversations.assignedUserId),
      ),
    )
    .orderBy(desc(conversations.createdAt))
    .limit(1);
  if (!row?.userId) return null;
  const member = await tx.execute<{ ok: number }>(
    sql`select 1 as ok from memberships where user_id = ${row.userId}::uuid and role <> 'viewer'`,
  );
  return member.length > 0 ? row.userId : null;
}

export interface InboundRoutingInput {
  tenantId: string;
  conversationId: string;
  contactId: string;
  channelConnectionId: string;
  created: boolean;
  now: Date;
}

/**
 * Applied on every new inbound message. A conversation that no automation will answer (AI not
 * in auto, assigned to a human, in handoff, or the contact's automations paused) needs a human:
 * it moves to `open` (new conversations, or closed ones when `reopenOnInbound`), returns to its
 * previous agent, or is auto-assigned. Returns true when the inbox row changed.
 */
export async function routeInbound(tx: Transaction, i: InboundRoutingInput): Promise<boolean> {
  const settings = await loadInboxSettings(tx, i.tenantId);
  const [conv] = await tx
    .select({
      aiMode: conversations.aiMode,
      status: conversations.status,
      inboxStatus: conversations.inboxStatus,
      assignedUserId: conversations.assignedUserId,
    })
    .from(conversations)
    .where(eq(conversations.id, i.conversationId))
    .for("update");
  if (!conv) return false;
  let changed = false;

  if (i.created && !conv.assignedUserId) {
    const prev = await previousAssignee(tx, i.contactId, i.channelConnectionId, i.conversationId);
    if (prev) {
      await tx
        .update(conversations)
        .set({ assignedUserId: prev, assignedAt: i.now, updatedAt: i.now })
        .where(eq(conversations.id, i.conversationId));
      conv.assignedUserId = prev;
      changed = true;
    }
  }

  const paused = await contactAutomationsPaused(tx, i.contactId, i.now);
  const automationOwns = conv.aiMode === "auto" && conv.status === "open" && !conv.assignedUserId && !paused;
  if (i.created) {
    const target = automationOwns ? "closed" : "open";
    if (conv.inboxStatus !== target) {
      await tx
        .update(conversations)
        .set({ inboxStatus: target, closedAt: target === "closed" ? i.now : null })
        .where(eq(conversations.id, i.conversationId));
      conv.inboxStatus = target;
      changed = true;
    }
  } else if (conv.inboxStatus === "closed" && !automationOwns && settings.reopenOnInbound) {
    await tx
      .update(conversations)
      .set({ inboxStatus: "open", closedAt: null, markedUnread: false, updatedAt: i.now })
      .where(eq(conversations.id, i.conversationId));
    conv.inboxStatus = "open";
    changed = true;
  }

  if (conv.inboxStatus === "open" && !conv.assignedUserId) {
    if (await autoAssign(tx, i.tenantId, i.conversationId, settings, i.now)) changed = true;
  }
  return changed;
}

/** Handoff (AI gave up): the conversation needs a human, so it goes to `open` and may be auto-assigned. */
export async function routeHandoff(tx: Transaction, tenantId: string, conversationId: string, now: Date): Promise<void> {
  const [conv] = await tx
    .update(conversations)
    .set({ inboxStatus: "open", closedAt: null, updatedAt: now })
    .where(eq(conversations.id, conversationId))
    .returning({ assignedUserId: conversations.assignedUserId });
  if (conv && !conv.assignedUserId) {
    await autoAssign(tx, tenantId, conversationId, await loadInboxSettings(tx, tenantId), now);
  }
}
