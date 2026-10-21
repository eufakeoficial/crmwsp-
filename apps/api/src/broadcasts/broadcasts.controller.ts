import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createBroadcastRequestSchema,
  listBroadcastsQuerySchema,
  patchBroadcastRequestSchema,
  previewAudienceRequestSchema,
  scheduleBroadcastRequestSchema,
  type AudiencePreview,
  type Broadcast,
  type BroadcastList,
  type BroadcastStats,
  type BroadcastTemplateList,
  type BroadcastVariableSource,
} from "@crmwsp/contracts";
import {
  and,
  broadcastRecipients,
  broadcasts,
  desc,
  eq,
  inArray,
  isNull,
  isUuid,
  messageTemplates,
  sql,
  type Transaction,
} from "@crmwsp/db";
import { canTransitionBroadcast, countTemplatePlaceholders } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { PlanLimitsService } from "../billing/plan-limits.service.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { loadAudienceContacts, planRecipients } from "./audience.js";

const INSERT_CHUNK = 1000;

type Row = typeof broadcasts.$inferSelect;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

function toDto(r: Row): Broadcast {
  return {
    id: r.id,
    name: r.name,
    channelConnectionId: r.channelConnectionId,
    templateId: r.templateId,
    variableMapping: r.variableMapping as BroadcastVariableSource[],
    audience: {
      tags: r.audience.tags ?? [],
      excludeTags: r.audience.excludeTags ?? [],
      ...(r.audience.segmentId ? { segmentId: r.audience.segmentId } : {}),
    },
    status: r.status,
    scheduledAt: iso(r.scheduledAt),
    startedAt: iso(r.startedAt),
    completedAt: iso(r.completedAt),
    cancelledAt: iso(r.cancelledAt),
    reservedSends: r.reservedSends,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

async function lockBroadcast(tx: Transaction, id: string): Promise<Row> {
  if (!isUuid(id)) throw new NotFoundError();
  const [r] = await tx.select().from(broadcasts).where(eq(broadcasts.id, id)).for("update");
  if (!r) throw new NotFoundError();
  return r;
}

/** Template must exist and be approved; returns its channel and placeholder count. */
async function loadApprovedTemplate(tx: Transaction, templateId: string): Promise<{ channelConnectionId: string; placeholders: number }> {
  const [t] = await tx
    .select({ status: messageTemplates.status, channel: messageTemplates.channelConnectionId, body: messageTemplates.body, externalId: messageTemplates.externalId })
    .from(messageTemplates)
    .where(eq(messageTemplates.id, templateId));
  if (!t) throw new NotFoundError();
  if (t.status !== "approved" || !t.externalId) throw new ValidationError("template must be approved by WhatsApp");
  return { channelConnectionId: t.channel, placeholders: countTemplatePlaceholders(t.body) };
}

function assertMapping(mapping: readonly unknown[], placeholders: number): void {
  if (mapping.length !== placeholders) {
    throw new ValidationError(`template has ${placeholders} variable(s); variableMapping has ${mapping.length}`);
  }
}

export async function broadcastStats(tx: Transaction, id: string): Promise<BroadcastStats> {
  const rows = await tx
    .select({ status: broadcastRecipients.status, n: sql<number>`count(*)::int` })
    .from(broadcastRecipients)
    .where(eq(broadcastRecipients.broadcastId, id))
    .groupBy(broadcastRecipients.status);
  const s: BroadcastStats = { total: 0, pending: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 };
  for (const r of rows) {
    s[r.status] = r.n;
    s.total += r.n;
  }
  return s;
}

@Controller("broadcasts")
// SessionGuard is global (APP_GUARD) and runs first.
@UseGuards(TenantGuard)
export class BroadcastsController {
  constructor(@Inject(PlanLimitsService) private readonly limits: PlanLimitsService) {}

  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<BroadcastList> {
    const q = parseOrThrow(listBroadcastsQuerySchema, query);
    const rows = await db.run((tx) =>
      tx
        .select()
        .from(broadcasts)
        .where(q.status ? eq(broadcasts.status, q.status) : undefined)
        .orderBy(desc(broadcasts.createdAt), desc(broadcasts.id))
        .limit(q.limit ?? 50),
    );
    return { items: rows.map(toDto) };
  }

  @Get("templates")
  async templates(@CurrentTenantDb() db: TenantDb): Promise<BroadcastTemplateList> {
    const rows = await db.run((tx) =>
      tx
        .select({
          id: messageTemplates.id,
          name: messageTemplates.name,
          language: messageTemplates.language,
          category: messageTemplates.category,
          body: messageTemplates.body,
          channelConnectionId: messageTemplates.channelConnectionId,
          externalId: messageTemplates.externalId,
        })
        .from(messageTemplates)
        .where(eq(messageTemplates.status, "approved"))
        .orderBy(messageTemplates.name),
    );
    return {
      items: rows
        .filter((r) => r.externalId)
        .map(({ externalId: _e, ...r }) => ({ ...r, placeholders: countTemplatePlaceholders(r.body) })),
    };
  }

  @Post("preview")
  // Read-only audience count (POST only to carry the filter body): viewers may use it.
  @Roles("owner", "admin", "agent", "viewer")
  @HttpCode(200)
  async preview(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<AudiencePreview> {
    const { audience } = parseOrThrow(previewAudienceRequestSchema, body);
    return db.run(async (tx) => {
      const plan = planRecipients(await loadAudienceContacts(tx, audience), audience, []);
      return { count: plan.recipients.length, excludedNoConsent: plan.excludedNoConsent };
    });
  }

  @Get(":id")
  async get(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Broadcast> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const [r] = await tx.select().from(broadcasts).where(eq(broadcasts.id, id));
      if (!r) throw new NotFoundError();
      return toDto(r);
    });
  }

  @Get(":id/stats")
  async stats(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<BroadcastStats> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const [r] = await tx.select({ id: broadcasts.id }).from(broadcasts).where(eq(broadcasts.id, id));
      if (!r) throw new NotFoundError();
      return broadcastStats(tx, id);
    });
  }

  @Post()
  @Roles("owner", "admin")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Broadcast> {
    const input = parseOrThrow(createBroadcastRequestSchema, body);
    return db.run(async (tx) => {
      const tpl = await loadApprovedTemplate(tx, input.templateId);
      assertMapping(input.variableMapping, tpl.placeholders);
      const [row] = await tx
        .insert(broadcasts)
        .values({
          tenantId: db.tenantId,
          name: input.name,
          templateId: input.templateId,
          channelConnectionId: tpl.channelConnectionId,
          variableMapping: input.variableMapping,
          audience: input.audience,
          createdBy: db.userId,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "broadcast", entityId: row.id, action: "broadcast.created", diff: { name: input.name }, ip: req.ip });
      return toDto(row);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Broadcast> {
    const input = parseOrThrow(patchBroadcastRequestSchema, body);
    return db.run(async (tx) => {
      const before = await lockBroadcast(tx, id);
      if (before.status !== "draft") throw new ConflictError(`broadcast is ${before.status}`);
      const templateId = input.templateId ?? before.templateId;
      const tpl = await loadApprovedTemplate(tx, templateId);
      const mapping = input.variableMapping ?? (before.variableMapping as BroadcastVariableSource[]);
      assertMapping(mapping, tpl.placeholders);
      const [row] = await tx
        .update(broadcasts)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.audience !== undefined ? { audience: input.audience } : {}),
          templateId,
          channelConnectionId: tpl.channelConnectionId,
          variableMapping: mapping,
          updatedAt: new Date(),
        })
        .where(eq(broadcasts.id, before.id))
        .returning();
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "broadcast", entityId: row.id, action: "broadcast.updated", diff: input, ip: req.ip });
      return toDto(row);
    });
  }

  @Delete(":id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    await db.run(async (tx) => {
      const before = await lockBroadcast(tx, id);
      if (before.status !== "draft") throw new ConflictError("only drafts can be deleted; cancel it instead");
      await tx.delete(broadcasts).where(eq(broadcasts.id, before.id));
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "broadcast", entityId: before.id, action: "broadcast.deleted", ip: req.ip });
    });
  }

  /**
   * Freezes the audience (opt-in only, deduped by phone) and books the sends atomically against
   * the plan's `broadcast_sends` cap in the same transaction: exceeding it throws 402 and nothing
   * is written. The worker starts sending at `scheduledAt` (now when omitted).
   */
  @Post(":id/schedule")
  @Roles("owner", "admin")
  @HttpCode(200)
  async schedule(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Broadcast> {
    const input = parseOrThrow(scheduleBroadcastRequestSchema, body ?? {});
    return db.run(async (tx) => {
      const before = await lockBroadcast(tx, id);
      if (!canTransitionBroadcast(before.status, "scheduled")) throw new ConflictError(`broadcast is ${before.status}`);
      const tpl = await loadApprovedTemplate(tx, before.templateId);
      const mapping = before.variableMapping as BroadcastVariableSource[];
      assertMapping(mapping, tpl.placeholders);
      const audience = {
        tags: before.audience.tags ?? [],
        excludeTags: before.audience.excludeTags ?? [],
        ...(before.audience.segmentId ? { segmentId: before.audience.segmentId } : {}),
      };
      const plan = planRecipients(await loadAudienceContacts(tx, audience), audience, mapping);
      const n = plan.recipients.length;
      if (n === 0) throw new ValidationError("audience is empty (no contacts with marketing opt-in match the filter)");
      await this.limits.consume(db.tenantId, "broadcast_sends", n, tx);
      for (let i = 0; i < n; i += INSERT_CHUNK) {
        await tx
          .insert(broadcastRecipients)
          .values(plan.recipients.slice(i, i + INSERT_CHUNK).map((r) => ({ tenantId: db.tenantId, broadcastId: before.id, ...r })))
          .onConflictDoNothing();
      }
      const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
      const [row] = await tx
        .update(broadcasts)
        .set({ status: "scheduled", scheduledAt, reservedSends: n, updatedAt: new Date() })
        .where(eq(broadcasts.id, before.id))
        .returning();
      if (!row) throw new NotFoundError();
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "broadcast",
        entityId: row.id,
        action: "broadcast.scheduled",
        diff: { recipients: n, excludedNoConsent: plan.excludedNoConsent, duplicates: plan.duplicates, missingVariables: plan.missingVariables, scheduledAt: scheduledAt.toISOString() },
        ip: req.ip,
      });
      return toDto(row);
    });
  }

  /** Stops the campaign: pending recipients are skipped; already-queued sends are dropped by the worker. */
  @Post(":id/cancel")
  @Roles("owner", "admin")
  @HttpCode(200)
  async cancel(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Broadcast> {
    return db.run(async (tx) => {
      const before = await lockBroadcast(tx, id);
      if (!canTransitionBroadcast(before.status, "cancelled")) throw new ConflictError(`broadcast is ${before.status}`);
      const now = new Date();
      await tx
        .update(broadcastRecipients)
        .set({ status: "skipped", error: { code: "cancelled" }, updatedAt: now })
        .where(and(eq(broadcastRecipients.broadcastId, before.id), inArray(broadcastRecipients.status, ["pending"]), isNull(broadcastRecipients.messageId)));
      const [row] = await tx
        .update(broadcasts)
        .set({ status: "cancelled", cancelledAt: now, updatedAt: now })
        .where(eq(broadcasts.id, before.id))
        .returning();
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "broadcast", entityId: row.id, action: "broadcast.cancelled", ip: req.ip });
      return toDto(row);
    });
  }
}
