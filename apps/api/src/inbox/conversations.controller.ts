import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  OutsideServiceWindowError,
  SERVICE_WINDOW_MS,
  ValidationError,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageRequestSchema,
  sendTemplateMessageRequestSchema,
  updateConversationRequestSchema,
  type Conversation,
  type ConversationListResponse,
  type Message,
  type MessageListResponse,
} from "@crmwsp/contracts";
import {
  and,
  conversations,
  desc,
  eq,
  isUuid,
  memberships,
  messages,
  messageTemplates,
  sql,
  type Transaction,
} from "@crmwsp/db";
import { renderTemplateBody, validateTemplateParams } from "@crmwsp/domain";
import type { Queue } from "bullmq";
import { CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { type HttpRequest, headerValue } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { writeAudit } from "./audit.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { ACTIVITY_US, selectConversations, withAttachments, type SQL } from "./inbox.queries.js";
import {
  OUTBOUND_QUEUE,
  SEND_MESSAGE_JOB,
  SEND_MESSAGE_JOB_OPTIONS,
  type SendMessageJobData,
} from "./outbound.constants.js";

const MESSAGE_US = sql`(extract(epoch from ${messages.createdAt}) * 1000000)::bigint`;

const messageColumns = {
  id: messages.id,
  conversationId: messages.conversationId,
  direction: messages.direction,
  type: messages.type,
  body: messages.body,
  status: messages.status,
  author: messages.author,
  authorUserId: messages.authorUserId,
  clientMessageId: messages.clientMessageId,
  error: messages.error,
  sentAt: messages.sentAt,
  createdAt: messages.createdAt,
};

/** If-Match: `3`, `"3"` or `W/"3"`. */
function parseIfMatch(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const m = /^(?:W\/)?"?(\d{1,9})"?$/.exec(raw.trim());
  if (!m?.[1]) throw new ValidationError("Invalid If-Match header");
  return Number(m[1]);
}

async function loadConversation(tx: Transaction, id: string): Promise<Conversation> {
  const [row] = await selectConversations(tx, [sql`c.id = ${id}`], 1);
  if (!row) throw new NotFoundError();
  return row.dto;
}

@Controller("conversations")
@UseGuards(TenantGuard)
export class ConversationsController {
  constructor(
    @Inject(OUTBOUND_QUEUE) private readonly queue: Queue,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
  ) {}

  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<ConversationListResponse> {
    const q = parseOrThrow(listConversationsQuerySchema, query);
    const where: SQL[] = [];
    if (q.status) where.push(sql`c.status = ${q.status}`);
    if (q.assignedTo === "me") where.push(sql`c.assigned_user_id = ${db.userId}`);
    else if (q.assignedTo === "unassigned") where.push(sql`c.assigned_user_id is null`);
    else if (q.assignedTo) where.push(sql`c.assigned_user_id = ${q.assignedTo}`);
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(sql`(${ACTIVITY_US}, c.id) < (${cur.t}::bigint, ${cur.id}::uuid)`);
    }
    const rows = await db.run((tx) => selectConversations(tx, where, q.limit + 1));
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => r.dto),
      nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.sortUs, id: last.dto.id }) : null,
    };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Conversation> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => loadConversation(tx, id));
  }

  @Get(":id/messages")
  async messages(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Query() query: unknown,
  ): Promise<MessageListResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const q = parseOrThrow(listMessagesQuerySchema, query);
    const cur = q.before ? decodeCursor(q.before) : undefined;
    return db.run(async (tx) => {
      const [conv] = await tx.select({ id: conversations.id }).from(conversations).where(eq(conversations.id, id));
      if (!conv) throw new NotFoundError();
      const rows = await tx
        .select({ ...messageColumns, sortUs: sql<string>`${MESSAGE_US}::text` })
        .from(messages)
        .where(
          and(
            eq(messages.conversationId, id),
            cur ? sql`(${MESSAGE_US}, ${messages.id}) < (${cur.t}::bigint, ${cur.id}::uuid)` : undefined,
          ),
        )
        .orderBy(desc(MESSAGE_US), desc(messages.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: await withAttachments(tx, page),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.sortUs, id: last.id }) : null,
      };
    });
  }

  @Post(":id/read")
  @HttpCode(204)
  async read(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    const [row] = await db.run((tx) =>
      tx
        .update(conversations)
        .set({ lastReadAt: sql`now()` })
        .where(eq(conversations.id, id))
        .returning({ id: conversations.id }),
    );
    if (!row) throw new NotFoundError();
    await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
  }

  @Patch(":id")
  async update(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Conversation> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateConversationRequestSchema, body);
    const headerVersion = parseIfMatch(headerValue(req, "if-match"));
    if (headerVersion !== undefined && input.lockVersion !== undefined && headerVersion !== input.lockVersion) {
      throw new ValidationError("If-Match and lockVersion disagree");
    }
    const expected = input.lockVersion ?? headerVersion;
    if (expected === undefined) throw new ValidationError("lockVersion or If-Match is required");

    const result = await db.run(async (tx) => {
      const [before] = await tx
        .select({
          status: conversations.status,
          assignedUserId: conversations.assignedUserId,
          aiMode: conversations.aiMode,
          lockVersion: conversations.lockVersion,
        })
        .from(conversations)
        .where(eq(conversations.id, id))
        .for("update");
      if (!before) throw new NotFoundError();
      if (before.lockVersion !== expected) throw new ConflictError("Conversation was modified; reload and retry");

      if (input.assignedUserId) {
        // memberships is tenant-scoped by RLS: users of other tenants are never found.
        const [member] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(eq(memberships.userId, input.assignedUserId));
        if (!member) throw new ValidationError("Assignee is not a member of this tenant");
      }

      const set: Partial<typeof conversations.$inferInsert> = {};
      const diff: Record<string, { from: unknown; to: unknown }> = {};
      if (input.status !== undefined && input.status !== before.status) {
        set.status = input.status;
        diff["status"] = { from: before.status, to: input.status };
      }
      if (input.assignedUserId !== undefined && input.assignedUserId !== before.assignedUserId) {
        set.assignedUserId = input.assignedUserId;
        diff["assignedUserId"] = { from: before.assignedUserId, to: input.assignedUserId };
      }
      if (input.aiMode !== undefined && input.aiMode !== before.aiMode) {
        set.aiMode = input.aiMode;
        diff["aiMode"] = { from: before.aiMode, to: input.aiMode };
      }
      if (Object.keys(diff).length === 0) return { conversation: await loadConversation(tx, id), changed: false };

      const [updated] = await tx
        .update(conversations)
        .set({ ...set, lockVersion: sql`${conversations.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(conversations.id, id), eq(conversations.lockVersion, expected)))
        .returning({ id: conversations.id });
      if (!updated) throw new ConflictError("Conversation was modified; reload and retry");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "conversation",
        entityId: id,
        action: "conversation.updated",
        diff,
        ip: req.ip,
      });
      return { conversation: await loadConversation(tx, id), changed: true };
    }).catch((err: unknown) => {
      // Reopening while another unresolved conversation exists for the same contact/channel.
      if ((err as { cause?: { code?: unknown } })?.cause?.code === "23505") {
        throw new ConflictError("Another open conversation exists for this contact");
      }
      throw err;
    });
    if (result.changed) await this.hub.publish(db.tenantId, { type: "conversation.updated", conversationId: id });
    return result.conversation;
  }

  @Post(":id/messages")
  @HttpCode(202)
  async send(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown): Promise<Message> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(sendMessageRequestSchema, body);

    const { message, created } = await db.run(async (tx) => {
      const findExisting = async () => {
        const [row] = await tx
          .select(messageColumns)
          .from(messages)
          .where(eq(messages.clientMessageId, input.clientMessageId));
        return row;
      };
      const [conv] = await tx
        .select({
          id: conversations.id,
          // Evaluated with the database clock, never the client's (nor this host's).
          inWindow: sql<boolean>`coalesce(${conversations.lastInboundAt} > now() - make_interval(secs => ${SERVICE_WINDOW_MS / 1000}), false)`,
        })
        .from(conversations)
        .where(eq(conversations.id, id));
      if (!conv) throw new NotFoundError();

      // Idempotent retry: answer with the original message, whatever the window says now.
      const existing = await findExisting();
      if (existing) {
        if (existing.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: existing, created: false };
      }

      if (!conv.inWindow) {
        throw new OutsideServiceWindowError();
      }

      const [inserted] = await tx
        .insert(messages)
        .values({
          tenantId: db.tenantId,
          conversationId: id,
          direction: "outbound",
          type: "text",
          body: input.text,
          status: "queued",
          author: "user",
          authorUserId: db.userId,
          clientMessageId: input.clientMessageId,
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning(messageColumns);
      if (!inserted) {
        // Concurrent duplicate committed first.
        const dup = await findExisting();
        if (!dup || dup.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: dup, created: false };
      }
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${inserted.createdAt.toISOString()}::timestamptz), ${inserted.createdAt.toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
      return { message: inserted, created: true };
    });

    if (message.status === "queued") {
      // Also re-enqueued on idempotent retries: recovers a lost enqueue; jobId dedupes in BullMQ.
      const data: SendMessageJobData = { tenantId: db.tenantId, messageId: message.id };
      await this.queue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: message.id });
    }
    if (created) {
      await this.hub.publish(db.tenantId, { type: "message.created", conversationId: id, messageId: message.id });
    }
    const [dto] = await db.run((tx) => withAttachments(tx, [message]));
    if (!dto) throw new NotFoundError();
    return dto;
  }
  /** Manual template send: the only way to write outside the 24 h window (T21). */
  @Post(":id/template-messages")
  @HttpCode(202)
  async sendTemplate(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown): Promise<Message> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(sendTemplateMessageRequestSchema, body);

    const { message, created } = await db.run(async (tx) => {
      const findExisting = async () => {
        const [row] = await tx
          .select(messageColumns)
          .from(messages)
          .where(eq(messages.clientMessageId, input.clientMessageId));
        return row;
      };
      const [conv] = await tx
        .select({ id: conversations.id, channelConnectionId: conversations.channelConnectionId })
        .from(conversations)
        .where(eq(conversations.id, id));
      if (!conv) throw new NotFoundError();
      // Idempotent retry: answer with the original message, never send (bill) twice.
      const existing = await findExisting();
      if (existing) {
        if (existing.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: existing, created: false };
      }
      const [tpl] = await tx
        .select({ id: messageTemplates.id, body: messageTemplates.body, externalId: messageTemplates.externalId })
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.id, input.templateId),
            eq(messageTemplates.channelConnectionId, conv.channelConnectionId),
            eq(messageTemplates.status, "approved"),
          ),
        );
      if (!tpl || !tpl.externalId) throw new ValidationError("Template is not approved for this channel");
      const issue = validateTemplateParams(tpl.body, input.params);
      if (issue) throw new ValidationError(`Invalid template params (${issue})`);

      const [inserted] = await tx
        .insert(messages)
        .values({
          tenantId: db.tenantId,
          conversationId: id,
          direction: "outbound",
          type: "template",
          body: renderTemplateBody(tpl.body, input.params),
          status: "queued",
          author: "user",
          authorUserId: db.userId,
          templateId: tpl.id,
          templateParams: input.params,
          clientMessageId: input.clientMessageId,
        })
        .onConflictDoNothing({
          target: [messages.tenantId, messages.clientMessageId],
          where: sql`${messages.clientMessageId} is not null`,
        })
        .returning(messageColumns);
      if (!inserted) {
        // Concurrent duplicate committed first.
        const dup = await findExisting();
        if (!dup || dup.conversationId !== id) throw new ConflictError("clientMessageId already used");
        return { message: dup, created: false };
      }
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${inserted.createdAt.toISOString()}::timestamptz), ${inserted.createdAt.toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, id));
      return { message: inserted, created: true };
    });

    // Enqueued after commit, only for the request that created the message; params never travel in the job.
    if (created) {
      const data: SendMessageJobData = { tenantId: db.tenantId, messageId: message.id };
      await this.queue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: message.id });
      await this.hub.publish(db.tenantId, { type: "message.created", conversationId: id, messageId: message.id });
    }
    const [dto] = await db.run((tx) => withAttachments(tx, [message]));
    if (!dto) throw new NotFoundError();
    return dto;
  }
}
