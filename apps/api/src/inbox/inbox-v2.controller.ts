import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  assignConversationRequestSchema,
  createNoteRequestSchema,
  createReminderRequestSchema,
  listInboxConversationsQuerySchema,
  pauseAutomationsRequestSchema,
  setInboxStatusRequestSchema,
  updateReminderRequestSchema,
  type ContactPanel,
  type ConversationNote,
  type InboxConversation,
  type InboxConversationListResponse,
  type InboxCounts,
  type NoteListResponse,
  type Reminder,
  type ReminderListResponse,
} from "@crmwsp/contracts";
import {
  adAttributions,
  and,
  asc,
  contacts,
  conversationNotes,
  conversationReminders,
  conversations,
  eq,
  isUuid,
  memberships,
  sql,
  tags,
  users,
  inArray,
  type Transaction,
} from "@crmwsp/db";
import { regionForPhone, reminderTime } from "@crmwsp/domain";
import { CurrentTenant, CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { writeAudit } from "./audit.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { ACTIVITY_US, selectConversations, type SQL } from "./inbox.queries.js";
import { assertConversationVisible, likeEscape, loadInboxSettings, visibilityWhere } from "./inbox-v2.scope.js";

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

type ReminderRow = typeof conversationReminders.$inferSelect;
const toReminder = (r: ReminderRow): Reminder => ({
  id: r.id,
  conversationId: r.conversationId,
  userId: r.userId,
  remindAt: r.remindAt.toISOString(),
  note: r.note,
  done: r.done,
  notifiedAt: iso(r.notifiedAt),
  createdAt: r.createdAt.toISOString(),
});

/**
 * Inbox v2 (T23): folders, filters, counts, assignment, internal notes, reminders and the
 * contact panel. Every query runs in TenantDb.run (RLS) and honours the visibility setting.
 */
@Controller("inbox")
@UseGuards(TenantGuard)
export class InboxV2Controller {
  constructor(@Inject(RealtimeHub) private readonly hub: RealtimeHub) {}

  private async loadOne(tx: Transaction, db: TenantDb, id: string): Promise<InboxConversation> {
    const [row] = await selectConversations(tx, [sql`c.id = ${id}::uuid`], 1, { reminderUserId: db.userId });
    if (!row) throw new NotFoundError();
    return row.inbox;
  }

  @Get("conversations")
  async list(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Query() query: unknown,
  ): Promise<InboxConversationListResponse> {
    const q = parseOrThrow(listInboxConversationsQuerySchema, query);
    return db.run(async (tx) => {
      const settings = await loadInboxSettings(tx, db.tenantId);
      const where: SQL[] = [];
      const scope = visibilityWhere(settings, tenant.role, db.userId);
      if (scope) where.push(scope);
      if (q.status !== "all") where.push(sql`c.inbox_status = ${q.status}`);
      if (q.unread) {
        where.push(sql`(c.marked_unread or exists (
          select 1 from messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id
            and m.direction = 'inbound' and (c.last_read_at is null or m.created_at > c.last_read_at)))`);
      }
      if (q.reminders) {
        where.push(sql`exists (select 1 from conversation_reminders r where r.tenant_id = c.tenant_id
          and r.conversation_id = c.id and r.done = false and r.user_id = ${db.userId}::uuid)`);
      }
      if (q.assignedTo === "me") where.push(sql`c.assigned_user_id = ${db.userId}::uuid`);
      else if (q.assignedTo === "unassigned") where.push(sql`c.assigned_user_id is null`);
      else if (q.assignedTo) where.push(sql`c.assigned_user_id = ${q.assignedTo}::uuid`);
      if (q.tag) where.push(sql`${q.tag} = any(ct.tags)`);
      if (q.channelConnectionId) where.push(sql`c.channel_connection_id = ${q.channelConnectionId}::uuid`);
      if (q.q) {
        const pattern = `%${likeEscape(q.q)}%`;
        where.push(sql`(ct.name ilike ${pattern} or ct.phone_e164 ilike ${pattern} or exists (
          select 1 from messages sm where sm.tenant_id = c.tenant_id and sm.conversation_id = c.id
            and sm.body ilike ${pattern}))`);
      }
      if (q.cursor) {
        const cur = decodeCursor(q.cursor);
        where.push(
          q.sort === "oldest"
            ? sql`(${ACTIVITY_US}, c.id) > (${cur.t}::bigint, ${cur.id}::uuid)`
            : sql`(${ACTIVITY_US}, c.id) < (${cur.t}::bigint, ${cur.id}::uuid)`,
        );
      }
      const rows = await selectConversations(tx, where, q.limit + 1, { order: q.sort, reminderUserId: db.userId });
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: page.map((r) => r.inbox),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.sortUs, id: last.dto.id }) : null,
      };
    });
  }

  @Get("counts")
  async counts(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant): Promise<InboxCounts> {
    return db.run(async (tx) => {
      const settings = await loadInboxSettings(tx, db.tenantId);
      const scope = visibilityWhere(settings, tenant.role, db.userId);
      const scopeSql = scope ? sql`and ${scope}` : sql``;
      const [totals] = await tx.execute<{
        open: number;
        closed: number;
        unread: number;
        mine: number;
        unassigned: number;
      }>(sql`
        select
          count(*) filter (where c.inbox_status = 'open')::int as open,
          count(*) filter (where c.inbox_status = 'closed')::int as closed,
          count(*) filter (where c.inbox_status = 'open' and (c.marked_unread or exists (
            select 1 from messages m where m.tenant_id = c.tenant_id and m.conversation_id = c.id
              and m.direction = 'inbound' and (c.last_read_at is null or m.created_at > c.last_read_at))))::int as unread,
          count(*) filter (where c.inbox_status = 'open' and c.assigned_user_id = ${db.userId}::uuid)::int as mine,
          count(*) filter (where c.inbox_status = 'open' and c.assigned_user_id is null)::int as unassigned
        from conversations c where true ${scopeSql}`);
      const [rem] = await tx.execute<{ due: number; total: number }>(sql`
        select count(*) filter (where r.remind_at <= now())::int as due, count(*)::int as total
        from conversation_reminders r join conversations c on c.id = r.conversation_id
        where r.done = false and r.user_id = ${db.userId}::uuid ${scopeSql}`);
      const tagRows = await tx.execute<{ name: string; count: number }>(sql`
        select t.name, count(*)::int as count
        from conversations c join contacts ct on ct.id = c.contact_id, unnest(ct.tags) as t(name)
        where c.inbox_status = 'open' ${scopeSql}
        group by t.name order by t.name`);
      return {
        open: Number(totals?.open ?? 0),
        closed: Number(totals?.closed ?? 0),
        unread: Number(totals?.unread ?? 0),
        mine: Number(totals?.mine ?? 0),
        unassigned: Number(totals?.unassigned ?? 0),
        remindersDue: Number(rem?.due ?? 0),
        reminders: Number(rem?.total ?? 0),
        tags: tagRows.map((t) => ({ name: t.name, count: Number(t.count) })),
      };
    });
  }

  @Get("conversations/:id")
  async detail(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<InboxConversation> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      return this.loadOne(tx, db, id);
    });
  }

  @Post("conversations/:id/assign")
  @HttpCode(200)
  async assign(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<InboxConversation> {
    if (!isUuid(id)) throw new NotFoundError();
    if (tenant.role === "viewer") throw new NotFoundError();
    const input = parseOrThrow(assignConversationRequestSchema, body);
    const assignee = input.assignee === "me" ? db.userId : input.assignee;
    const result = await db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      if (assignee) {
        // memberships is tenant-scoped by RLS: users of other tenants are never found.
        const [member] = await tx
          .select({ role: memberships.role })
          .from(memberships)
          .where(eq(memberships.userId, assignee));
        if (!member || member.role === "viewer") throw new ValidationError("Assignee is not an agent of this tenant");
      }
      const [before] = await tx
        .select({ assignedUserId: conversations.assignedUserId })
        .from(conversations)
        .where(eq(conversations.id, id))
        .for("update");
      if (!before) throw new NotFoundError();
      if (before.assignedUserId === assignee) return { conversation: await this.loadOne(tx, db, id), changed: false };
      await tx
        .update(conversations)
        .set({
          assignedUserId: assignee,
          assignedAt: assignee ? new Date() : null,
          lockVersion: sql`${conversations.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "conversation",
        entityId: id,
        action: assignee ? "conversation.assigned" : "conversation.unassigned",
        diff: { assignedUserId: { from: before.assignedUserId, to: assignee } },
        ip: req.ip,
      });
      return { conversation: await this.loadOne(tx, db, id), changed: true };
    });
    if (result.changed) await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
    return result.conversation;
  }

  @Post("conversations/:id/status")
  @HttpCode(200)
  async setStatus(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<InboxConversation> {
    if (!isUuid(id)) throw new NotFoundError();
    if (tenant.role === "viewer") throw new NotFoundError();
    const input = parseOrThrow(setInboxStatusRequestSchema, body);
    const result = await db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const [before] = await tx
        .select({ inboxStatus: conversations.inboxStatus })
        .from(conversations)
        .where(eq(conversations.id, id))
        .for("update");
      if (!before) throw new NotFoundError();
      if (before.inboxStatus === input.status) return { conversation: await this.loadOne(tx, db, id), changed: false };
      await tx
        .update(conversations)
        .set({
          inboxStatus: input.status,
          closedAt: input.status === "closed" ? new Date() : null,
          lockVersion: sql`${conversations.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "conversation",
        entityId: id,
        action: input.status === "closed" ? "conversation.closed" : "conversation.reopened",
        diff: { inboxStatus: { from: before.inboxStatus, to: input.status } },
        ip: req.ip,
      });
      return { conversation: await this.loadOne(tx, db, id), changed: true };
    });
    if (result.changed) await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
    return result.conversation;
  }

  /** Marks the conversation as unread for the team (cleared by POST /conversations/:id/read). */
  @Post("conversations/:id/unread")
  @HttpCode(204)
  async markUnread(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      await tx.update(conversations).set({ markedUnread: true }).where(eq(conversations.id, id));
    });
    await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
  }

  // --- Notes ---------------------------------------------------------------------

  @Get("conversations/:id/notes")
  async notes(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<NoteListResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const rows = await tx
        .select({
          id: conversationNotes.id,
          conversationId: conversationNotes.conversationId,
          body: conversationNotes.body,
          createdAt: conversationNotes.createdAt,
          authorId: users.id,
          authorName: users.name,
          authorEmail: users.email,
        })
        .from(conversationNotes)
        .leftJoin(users, eq(users.id, conversationNotes.authorId))
        .where(eq(conversationNotes.conversationId, id))
        .orderBy(asc(conversationNotes.createdAt), asc(conversationNotes.id))
        .limit(500);
      return {
        items: rows.map(
          (r): ConversationNote => ({
            id: r.id,
            conversationId: r.conversationId,
            author: r.authorId && r.authorEmail ? { id: r.authorId, name: r.authorName, email: r.authorEmail } : null,
            body: r.body,
            createdAt: r.createdAt.toISOString(),
          }),
        ),
      };
    });
  }

  /** Internal note: stored and published over SSE, never sent to the channel. */
  @Post("conversations/:id/notes")
  @HttpCode(201)
  async addNote(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ConversationNote> {
    if (!isUuid(id)) throw new NotFoundError();
    if (tenant.role === "viewer") throw new NotFoundError();
    const input = parseOrThrow(createNoteRequestSchema, body);
    const note = await db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const [row] = await tx
        .insert(conversationNotes)
        .values({ tenantId: db.tenantId, conversationId: id, authorId: db.userId, body: input.body })
        .returning();
      if (!row) throw new Error("note insert returned no row");
      const [author] = await tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(eq(users.id, db.userId));
      return {
        id: row.id,
        conversationId: id,
        author: author ?? null,
        body: row.body,
        createdAt: row.createdAt.toISOString(),
      } satisfies ConversationNote;
    });
    await this.hub.publish(db.tenantId, { type: "note.created", conversationId: id, noteId: note.id });
    return note;
  }

  // --- Reminders -----------------------------------------------------------------

  @Get("reminders")
  async myReminders(@CurrentTenantDb() db: TenantDb): Promise<ReminderListResponse> {
    const rows = await db.run((tx) =>
      tx
        .select()
        .from(conversationReminders)
        .where(and(eq(conversationReminders.userId, db.userId), eq(conversationReminders.done, false)))
        .orderBy(asc(conversationReminders.remindAt))
        .limit(200),
    );
    return { items: rows.map(toReminder) };
  }

  @Get("conversations/:id/reminders")
  async reminders(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
  ): Promise<ReminderListResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const rows = await tx
        .select()
        .from(conversationReminders)
        .where(and(eq(conversationReminders.conversationId, id), eq(conversationReminders.userId, db.userId)))
        .orderBy(asc(conversationReminders.remindAt))
        .limit(100);
      return { items: rows.map(toReminder) };
    });
  }

  @Post("conversations/:id/reminders")
  @HttpCode(201)
  async addReminder(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Reminder> {
    if (!isUuid(id)) throw new NotFoundError();
    if (tenant.role === "viewer") throw new NotFoundError();
    const input = parseOrThrow(createReminderRequestSchema, body);
    const at = reminderTime(input.preset, new Date(), input.remindAt ? new Date(input.remindAt) : null);
    if (!at.ok) throw new ValidationError(`Invalid reminder time (${at.reason})`);
    const row = await db.run(async (tx) => {
      await assertConversationVisible(tx, db.tenantId, tenant.role, db.userId, id);
      const [r] = await tx
        .insert(conversationReminders)
        .values({ tenantId: db.tenantId, conversationId: id, userId: db.userId, remindAt: at.remindAt, note: input.note ?? null })
        .returning();
      if (!r) throw new Error("reminder insert returned no row");
      return r;
    });
    await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
    return toReminder(row);
  }

  @Patch("reminders/:id")
  async updateReminder(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown): Promise<Reminder> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateReminderRequestSchema, body);
    const [row] = await db.run((tx) =>
      tx
        .update(conversationReminders)
        .set({ done: input.done, updatedAt: new Date() })
        .where(and(eq(conversationReminders.id, id), eq(conversationReminders.userId, db.userId)))
        .returning(),
    );
    if (!row) throw new NotFoundError();
    await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: row.conversationId });
    return toReminder(row);
  }

  @Delete("reminders/:id")
  @HttpCode(204)
  async deleteReminder(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    const [row] = await db.run((tx) =>
      tx
        .delete(conversationReminders)
        .where(and(eq(conversationReminders.id, id), eq(conversationReminders.userId, db.userId)))
        .returning({ conversationId: conversationReminders.conversationId }),
    );
    if (!row) throw new NotFoundError();
    await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: row.conversationId });
  }

  // --- Contact panel ---------------------------------------------------------------

  @Get("contacts/:id/panel")
  async contactPanel(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<ContactPanel> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const [ct] = await tx.select().from(contacts).where(eq(contacts.id, id));
      if (!ct) throw new NotFoundError();
      const [ad] = await tx.select().from(adAttributions).where(eq(adAttributions.contactId, id)).limit(1);
      const [first] = await tx.execute<{ first_inbound_at: Date | string | null }>(sql`
        select min(m.created_at) as first_inbound_at from messages m
        join conversations c on c.id = m.conversation_id
        where c.contact_id = ${id}::uuid and m.direction = 'inbound'`);
      const firstInbound = first?.first_inbound_at ? new Date(first.first_inbound_at) : null;
      const meta =
        ct.tags.length === 0
          ? []
          : await tx.select({ name: tags.name, emoji: tags.emoji, color: tags.color }).from(tags).where(inArray(tags.name, ct.tags));
      const byName = new Map(meta.map((m) => [m.name, m]));
      const region = regionForPhone(ct.phoneE164);
      return {
        contactId: ct.id,
        origin: ad ? "ad" : firstInbound ? "whatsapp" : "manual",
        ad: ad
          ? {
              sourceId: ad.sourceId,
              sourceType: ad.sourceType,
              sourceUrl: ad.sourceUrl,
              headline: ad.headline,
              firstSeenAt: ad.firstSeenAt.toISOString(),
            }
          : null,
        country: region.country,
        timezone: region.timezone,
        firstContactAt: ct.createdAt.toISOString(),
        firstInboundAt: iso(firstInbound),
        automationsPausedUntil: iso(ct.automationsPausedUntil),
        tags: ct.tags.map((name) => ({ name, emoji: byName.get(name)?.emoji ?? null, color: byName.get(name)?.color ?? null })),
      };
    });
  }

  /** Pauses (minutes) or resumes (null) the AI turn and follow-ups for a contact. */
  @Post("contacts/:id/pause-automations")
  @HttpCode(200)
  async pauseAutomations(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<{ automationsPausedUntil: string | null }> {
    if (!isUuid(id)) throw new NotFoundError();
    if (tenant.role === "viewer") throw new NotFoundError();
    const input = parseOrThrow(pauseAutomationsRequestSchema, body);
    const until = input.minutes === null ? null : new Date(Date.now() + input.minutes * 60_000);
    const convIds = await db.run(async (tx) => {
      const [row] = await tx
        .update(contacts)
        .set({ automationsPausedUntil: until, updatedAt: new Date() })
        .where(eq(contacts.id, id))
        .returning({ id: contacts.id });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "contact",
        entityId: id,
        action: until ? "contact.automations_paused" : "contact.automations_resumed",
        diff: { automationsPausedUntil: iso(until) },
        ip: req.ip,
      });
      const convs = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.contactId, id));
      return convs.map((c) => c.id);
    });
    for (const conversationId of convIds) await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId });
    return { automationsPausedUntil: iso(until) };
  }
}
