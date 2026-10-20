import { MESSAGE_PREVIEW_MAX, type Conversation, type InboxConversation, type Message } from "@crmwsp/contracts";
import { asc, attachments, inArray, sql, type Transaction } from "@crmwsp/db";

export type SQL = ReturnType<typeof sql>;

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

interface ConversationRow extends Record<string, unknown> {
  id: string;
  status: Conversation["status"];
  ai_mode: Conversation["aiMode"];
  channel_connection_id: string;
  last_inbound_at: Date | string | null;
  last_message_at: Date | string | null;
  last_read_at: Date | string | null;
  lock_version: number;
  created_at: Date | string;
  updated_at: Date | string;
  contact_id: string;
  contact_name: string | null;
  contact_phone: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_email: string | null;
  lm_id: string | null;
  lm_direction: "inbound" | "outbound" | null;
  lm_type: Message["type"] | null;
  lm_status: Message["status"] | null;
  lm_preview: string | null;
  lm_created_at: Date | string | null;
  unread_count: number;
  sort_us: string;
  inbox_status: InboxConversation["inboxStatus"];
  marked_unread: boolean;
  assigned_at: Date | string | null;
  closed_at: Date | string | null;
  contact_tags: string[] | null;
  automations_paused_until: Date | string | null;
  next_reminder_at: Date | string | null;
}

export interface SelectConversationsOptions {
  order?: "newest" | "oldest";
  /** User whose pending reminders feed `nextReminderAt` (null for none). */
  reminderUserId?: string | null;
}

/** Sort key of the inbox: last activity (conversations without messages fall back to created_at). */
export const ACTIVITY_US = sql`(extract(epoch from coalesce(c.last_message_at, c.created_at)) * 1000000)::bigint`;

/**
 * Conversation rows with contact, assignee, last message preview and unread count.
 * Runs inside TenantDb.run: RLS limits every table to the current tenant.
 * Unread = inbound messages created after last_read_at (shared per conversation).
 */
export async function selectConversations(
  tx: Transaction,
  where: SQL[],
  limit: number,
  opts: SelectConversationsOptions = {},
): Promise<Array<{ dto: Conversation; inbox: InboxConversation; sortUs: string }>> {
  const dir = opts.order === "oldest" ? sql`asc` : sql`desc`;
  const reminderUser = opts.reminderUserId ?? null;
  const filter = where.length > 0 ? sql`where ${sql.join(where, sql` and `)}` : sql``;
  const rows = await tx.execute<ConversationRow>(sql`
    select c.id, c.status, c.ai_mode, c.channel_connection_id, c.last_inbound_at, c.last_message_at,
           c.last_read_at, c.lock_version, c.created_at, c.updated_at,
           ct.id as contact_id, ct.name as contact_name, ct.phone_e164 as contact_phone,
           u.id as assignee_id, u.name as assignee_name, u.email as assignee_email,
           lm.id as lm_id, lm.direction as lm_direction, lm.type as lm_type, lm.status as lm_status,
           left(lm.body, ${MESSAGE_PREVIEW_MAX}) as lm_preview, lm.created_at as lm_created_at,
           (select count(*)::int from messages m
             where m.tenant_id = c.tenant_id and m.conversation_id = c.id and m.direction = 'inbound'
               and (c.last_read_at is null or m.created_at > c.last_read_at)) as unread_count,
           ${ACTIVITY_US}::text as sort_us,
           c.inbox_status, c.marked_unread, c.assigned_at, c.closed_at,
           ct.tags as contact_tags, ct.automations_paused_until,
           (select min(r.remind_at) from conversation_reminders r
             where r.tenant_id = c.tenant_id and r.conversation_id = c.id and r.done = false
               and r.user_id = ${reminderUser}::uuid) as next_reminder_at
    from conversations c
    join contacts ct on ct.id = c.contact_id
    left join users u on u.id = c.assigned_user_id
    left join lateral (
      select m.id, m.direction, m.type, m.status, m.body, m.created_at from messages m
      where m.tenant_id = c.tenant_id and m.conversation_id = c.id
      order by m.created_at desc, m.id desc limit 1
    ) lm on true
    ${filter}
    order by ${ACTIVITY_US} ${dir}, c.id ${dir}
    limit ${limit}`);
  return rows.map((r) => {
    const dto: Conversation = {
      id: r.id,
      status: r.status,
      aiMode: r.ai_mode,
      channelConnectionId: r.channel_connection_id,
      contact: { id: r.contact_id, name: r.contact_name, phoneE164: r.contact_phone },
      assignee:
        r.assignee_id && r.assignee_email !== null
          ? { id: r.assignee_id, name: r.assignee_name, email: r.assignee_email }
          : null,
      lastMessage:
        r.lm_id && r.lm_direction && r.lm_type && r.lm_status && r.lm_created_at
          ? {
              id: r.lm_id,
              direction: r.lm_direction,
              type: r.lm_type,
              status: r.lm_status,
              preview: r.lm_preview,
              createdAt: iso(r.lm_created_at) as string,
            }
          : null,
      unreadCount: Number(r.unread_count),
      lastInboundAt: iso(r.last_inbound_at),
      lastMessageAt: iso(r.last_message_at),
      lastReadAt: iso(r.last_read_at),
      lockVersion: Number(r.lock_version),
      createdAt: iso(r.created_at) as string,
      updatedAt: iso(r.updated_at) as string,
    };
    const inbox: InboxConversation = {
      ...dto,
      inboxStatus: r.inbox_status,
      unread: dto.unreadCount > 0 || Boolean(r.marked_unread),
      markedUnread: Boolean(r.marked_unread),
      assignedAt: iso(r.assigned_at),
      closedAt: iso(r.closed_at),
      contactTags: r.contact_tags ?? [],
      automationsPausedUntil: iso(r.automations_paused_until),
      nextReminderAt: iso(r.next_reminder_at),
    };
    return { sortUs: r.sort_us, dto, inbox };
  });
}

export interface MessageRowLike {
  id: string;
  conversationId: string;
  direction: Message["direction"];
  type: Message["type"];
  body: string | null;
  status: Message["status"];
  author: Message["author"];
  authorUserId: string | null;
  clientMessageId: string | null;
  error: Record<string, unknown> | null;
  sentAt: Date | null;
  createdAt: Date;
}

/** Maps message rows to DTOs, loading their attachments in one query. */
export async function withAttachments(tx: Transaction, rows: MessageRowLike[]): Promise<Message[]> {
  const ids = rows.map((r) => r.id);
  const atts =
    ids.length === 0
      ? []
      : await tx
          .select()
          .from(attachments)
          .where(inArray(attachments.messageId, ids))
          .orderBy(asc(attachments.createdAt), asc(attachments.id));
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    direction: r.direction,
    type: r.type,
    body: r.body,
    status: r.status,
    author: r.author,
    authorUserId: r.authorUserId,
    clientMessageId: r.clientMessageId,
    error: r.error,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    attachments: atts
      .filter((a) => a.messageId === r.id)
      .map((a) => ({
        id: a.id,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        storageKey: a.storageKey,
        transcript: a.transcript,
      })),
  }));
}
