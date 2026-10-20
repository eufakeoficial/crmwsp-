import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  createFollowUpRequestSchema,
  listFollowUpsQuerySchema,
  patchFollowUpRequestSchema,
  patchFollowUpSettingsRequestSchema,
  type FollowUp,
  type FollowUpList,
  type FollowUpSettings,
} from "@crmwsp/contracts";
import {
  and,
  conversations,
  desc,
  eq,
  followUps,
  isUuid,
  messageTemplates,
  opportunities,
  orders,
  quotes,
  sql,
  tenants,
  type Transaction,
} from "@crmwsp/db";
import { mergeFollowUpSettings, resolveFollowUpSettings } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

const PENDING = new Set(["suggested", "scheduled"]);

const columns = {
  id: followUps.id,
  contactId: conversations.contactId,
  conversationId: followUps.conversationId,
  opportunityId: followUps.opportunityId,
  quoteId: followUps.quoteId,
  orderId: followUps.orderId,
  rule: followUps.rule,
  reason: followUps.reason,
  messageBody: followUps.messageBody,
  templateId: followUps.templateId,
  requiresTemplate: followUps.requiresTemplate,
  scheduledAt: followUps.scheduledAt,
  status: followUps.status,
  skipReason: followUps.skipReason,
  sentMessageId: followUps.sentMessageId,
  createdAt: followUps.createdAt,
  updatedAt: followUps.updatedAt,
};

interface Row extends Omit<FollowUp, "scheduledAt" | "createdAt" | "updatedAt"> {
  scheduledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toDto(r: Row): FollowUp {
  return {
    ...r,
    scheduledAt: r.scheduledAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

function selectFollowUps(tx: Transaction) {
  return tx.select(columns).from(followUps).innerJoin(conversations, eq(conversations.id, followUps.conversationId));
}

async function load(tx: Transaction, id: string): Promise<FollowUp> {
  const [r] = await selectFollowUps(tx).where(eq(followUps.id, id));
  if (!r) throw new NotFoundError();
  return toDto(r);
}

/** Template must exist, be approved and belong to the conversation's channel. */
async function assertTemplate(tx: Transaction, templateId: string, channelConnectionId: string): Promise<void> {
  const [t] = await tx
    .select({ status: messageTemplates.status, channel: messageTemplates.channelConnectionId })
    .from(messageTemplates)
    .where(eq(messageTemplates.id, templateId));
  if (!t) throw new NotFoundError();
  if (t.status !== "approved" || t.channel !== channelConnectionId) {
    throw new ValidationError("template must be approved and belong to the conversation channel");
  }
}

@Controller("follow-ups")
// SessionGuard is global (APP_GUARD) and runs first.
@UseGuards(TenantGuard)
export class FollowUpsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<FollowUpList> {
    const q = parseOrThrow(listFollowUpsQuerySchema, query);
    const where = [
      q.contactId ? eq(conversations.contactId, q.contactId) : undefined,
      q.conversationId ? eq(followUps.conversationId, q.conversationId) : undefined,
      q.status ? eq(followUps.status, q.status) : undefined,
    ].filter((w) => w !== undefined);
    const rows = await db.run((tx) =>
      selectFollowUps(tx)
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(followUps.scheduledAt), desc(followUps.id))
        .limit(q.limit ?? 50),
    );
    return { items: rows.map(toDto) };
  }

  @Get("settings")
  async getSettings(@CurrentTenantDb() db: TenantDb): Promise<FollowUpSettings> {
    return db.run(async (tx) => {
      const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId));
      return resolveFollowUpSettings(t?.settings["followUps"]);
    });
  }

  @Patch("settings")
  @Roles("owner", "admin")
  @HttpCode(200)
  async patchSettings(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<FollowUpSettings> {
    const patch = parseOrThrow(patchFollowUpSettingsRequestSchema, body);
    return db.run(async (tx) => {
      const [t] = await tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, db.tenantId))
        .for("update");
      if (!t) throw new NotFoundError();
      const next = mergeFollowUpSettings(resolveFollowUpSettings(t.settings["followUps"]), patch);
      for (const tpl of [next.leadStalled.templateId, next.orderPendingPayment.templateId]) {
        if (!tpl) continue;
        const [m] = await tx.select({ status: messageTemplates.status }).from(messageTemplates).where(eq(messageTemplates.id, tpl));
        if (!m) throw new NotFoundError();
        if (m.status !== "approved") throw new ValidationError("template must be approved");
      }
      await tx
        .update(tenants)
        .set({
          settings: sql`${tenants.settings} || jsonb_build_object('followUps', ${JSON.stringify(next)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, db.tenantId));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: db.tenantId,
        action: "follow_up_settings.updated",
        diff: patch,
        ip: req.ip,
      });
      return next;
    });
  }

  @Get(":id")
  async get(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<FollowUp> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => load(tx, id));
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<FollowUp> {
    const input = parseOrThrow(createFollowUpRequestSchema, body);
    return db.run(async (tx) => {
      const [c] = await tx
        .select({ channel: conversations.channelConnectionId })
        .from(conversations)
        .where(eq(conversations.id, input.conversationId));
      if (!c) throw new NotFoundError();
      if (input.templateId) await assertTemplate(tx, input.templateId, c.channel);
      if (input.opportunityId) {
        const [o] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, input.opportunityId));
        if (!o) throw new NotFoundError();
      }
      if (input.quoteId) {
        const [q] = await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.id, input.quoteId));
        if (!q) throw new NotFoundError();
      }
      if (input.orderId) {
        const [o] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.id, input.orderId));
        if (!o) throw new NotFoundError();
      }
      const [row] = await tx
        .insert(followUps)
        .values({
          tenantId: db.tenantId,
          conversationId: input.conversationId,
          opportunityId: input.opportunityId ?? null,
          quoteId: input.quoteId ?? null,
          orderId: input.orderId ?? null,
          rule: "manual",
          reason: input.reason,
          messageBody: input.messageBody ?? null,
          templateId: input.templateId ?? null,
          scheduledAt: new Date(input.scheduledAt),
          status: input.status,
        })
        .returning({ id: followUps.id });
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "follow_up",
        entityId: row.id,
        action: "follow_up.created",
        diff: { reason: input.reason, status: input.status },
        ip: req.ip,
      });
      return load(tx, row.id);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<FollowUp> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchFollowUpRequestSchema, body);
    return db.run(async (tx) => {
      // Same row lock the scheduler takes: a follow-up being dispatched cannot be edited concurrently.
      const [before] = await tx.select().from(followUps).where(eq(followUps.id, id)).for("update");
      if (!before) throw new NotFoundError();
      if (!PENDING.has(before.status)) throw new ValidationError(`follow-up is ${before.status}`);
      const set: Partial<typeof followUps.$inferInsert> = { updatedAt: new Date() };
      if (input.reason !== undefined) set.reason = input.reason;
      if (input.scheduledAt !== undefined) set.scheduledAt = new Date(input.scheduledAt);
      if (input.messageBody !== undefined) set.messageBody = input.messageBody;
      if (input.templateId !== undefined) {
        if (input.templateId) {
          const [c] = await tx
            .select({ channel: conversations.channelConnectionId })
            .from(conversations)
            .where(eq(conversations.id, before.conversationId));
          if (!c) throw new NotFoundError();
          await assertTemplate(tx, input.templateId, c.channel);
        }
        set.templateId = input.templateId;
      }
      if (input.status !== undefined) {
        set.status = input.status;
        if (input.status === "cancelled") set.skipReason = "cancelled_by_user";
      }
      const nextBody = set.messageBody !== undefined ? set.messageBody : before.messageBody;
      const nextTpl = set.templateId !== undefined ? set.templateId : before.templateId;
      if (!nextBody && !nextTpl) throw new ValidationError("messageBody or templateId is required");
      await tx.update(followUps).set(set).where(eq(followUps.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "follow_up",
        entityId: id,
        action: "follow_up.updated",
        diff: input,
        ip: req.ip,
      });
      return load(tx, id);
    });
  }
}
