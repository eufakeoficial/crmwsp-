import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createOpportunityRequestSchema,
  listOpportunitiesQuerySchema,
  moveOpportunityRequestSchema,
  patchOpportunityRequestSchema,
  type Opportunity,
  type OpportunityDetail,
  type OpportunityList,
  type PipelineList,
} from "@crmwsp/contracts";
import {
  and,
  asc,
  contacts,
  conversations,
  desc,
  eq,
  ilike,
  isUuid,
  opportunities,
  opportunityStageHistory,
  orders,
  or,
  pipelineStages,
  pipelines,
  quotes,
  sql,
  users,
} from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";
import {
  OPP_US,
  ensureDefaultPipeline,
  listPipelines,
  loadOpportunity,
  selectOpportunities,
} from "./opportunities.queries.js";
import { selectTasks } from "./tasks.queries.js";
import { assertMember, iso, likeEscape, modified, toNumReq } from "./util.js";

@Controller("pipelines")
@UseGuards(TenantGuard)
export class PipelinesController {
  /** Seeds the default pipeline on first read for tenants created before migration 0015. */
  @Get()
  async list(@CurrentTenantDb() db: TenantDb): Promise<PipelineList> {
    return {
      items: await db.run(async (tx) => {
        await ensureDefaultPipeline(tx, db.tenantId);
        return listPipelines(tx);
      }),
    };
  }
}

@Controller("opportunities")
@UseGuards(TenantGuard)
export class OpportunitiesController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<OpportunityList> {
    const q = parseOrThrow(listOpportunitiesQuerySchema, query);
    const pattern = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const where = [
      q.pipelineId ? eq(opportunities.pipelineId, q.pipelineId) : undefined,
      q.stageId ? eq(opportunities.stageId, q.stageId) : undefined,
      q.ownerId ? eq(opportunities.ownerUserId, q.ownerId === "me" ? db.userId : q.ownerId) : undefined,
      q.contactId ? eq(opportunities.contactId, q.contactId) : undefined,
      pattern
        ? or(ilike(opportunities.title, pattern), ilike(contacts.name, pattern), ilike(contacts.phoneE164, pattern))
        : undefined,
    ];
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(sql`(${OPP_US}, ${opportunities.id}) < (${cur.t}::bigint, ${cur.id}::uuid)`);
    }
    const page = await db.run((tx) => selectOpportunities(tx, where, q.limit + 1));
    const items = page.items.slice(0, q.limit);
    const last = items[items.length - 1];
    const lastUs = page.sortUs[items.length - 1];
    return {
      items,
      nextCursor: page.items.length > q.limit && last && lastUs ? encodeCursor({ t: lastUs, id: last.id }) : null,
    };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<OpportunityDetail> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const opp = await loadOpportunity(tx, id);
      const [raw] = await tx.select({ conversationId: opportunities.conversationId }).from(opportunities).where(eq(opportunities.id, id));
      const history = await tx
        .select({ h: opportunityStageHistory, userName: users.name, userEmail: users.email })
        .from(opportunityStageHistory)
        .leftJoin(users, eq(users.id, opportunityStageHistory.changedBy))
        .where(eq(opportunityStageHistory.opportunityId, id))
        .orderBy(desc(opportunityStageHistory.createdAt), desc(opportunityStageHistory.id));
      const qs = await tx
        .select({ id: quotes.id, number: quotes.number, status: quotes.status, total: quotes.totalMinor, currency: quotes.currency })
        .from(quotes)
        .where(eq(quotes.opportunityId, id))
        .orderBy(desc(quotes.createdAt));
      const os = await tx
        .select({ id: orders.id, number: orders.number, status: orders.status, total: orders.totalMinor, currency: orders.currency })
        .from(orders)
        .where(eq(orders.opportunityId, id))
        .orderBy(desc(orders.createdAt));
      return {
        ...opp,
        conversationId: raw?.conversationId ?? null,
        history: history.map(({ h, userName, userEmail }) => ({
          id: h.id,
          fromStageId: h.fromStageId,
          toStageId: h.toStageId,
          at: h.createdAt.toISOString(),
          actor: { type: h.changedByType, name: h.changedByType === "user" ? (userName ?? userEmail ?? null) : null },
          lostReason: h.reason,
        })),
        quotes: qs.map((q) => ({ id: q.id, number: q.number, status: q.status, totalMinor: toNumReq(q.total), currency: q.currency })),
        orders: os.map((o) => ({ id: o.id, number: o.number, status: o.status, totalMinor: toNumReq(o.total), currency: o.currency })),
        tasks: await selectTasks(tx, [sql`t.opportunity_id = ${id}`]),
      };
    });
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Opportunity> {
    const input = parseOrThrow(createOpportunityRequestSchema, body);
    return db.run(async (tx) => {
      const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!contact) throw new NotFoundError();
      await ensureDefaultPipeline(tx, db.tenantId);
      let stage: { id: string; pipelineId: string } | undefined;
      if (input.stageId) {
        [stage] = await tx
          .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
          .from(pipelineStages)
          .where(eq(pipelineStages.id, input.stageId));
        if (!stage) throw new ValidationError("Unknown stage");
      } else {
        [stage] = await tx
          .select({ id: pipelineStages.id, pipelineId: pipelineStages.pipelineId })
          .from(pipelineStages)
          .innerJoin(pipelines, eq(pipelines.id, pipelineStages.pipelineId))
          .where(and(eq(pipelines.isDefault, true), eq(pipelineStages.kind, "open")))
          .orderBy(asc(pipelineStages.position))
          .limit(1);
        if (!stage) throw new ValidationError("The default pipeline has no open stage");
      }
      const [conv] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.contactId, input.contactId))
        .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt))
        .limit(1);
      const [row] = await tx
        .insert(opportunities)
        .values({
          tenantId: db.tenantId,
          contactId: input.contactId,
          conversationId: conv?.id ?? null,
          pipelineId: stage.pipelineId,
          stageId: stage.id,
          title: input.title,
          valueMinor: input.valueMinor === undefined ? null : BigInt(input.valueMinor),
          currency: input.currency,
          ownerUserId: db.userId,
          source: "manual",
        })
        .returning({ id: opportunities.id });
      if (!row) throw new Error("insert returned no row");
      await tx.insert(opportunityStageHistory).values({
        tenantId: db.tenantId,
        opportunityId: row.id,
        fromStageId: null,
        toStageId: stage.id,
        changedByType: "user",
        changedBy: db.userId,
      });
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "opportunity",
        entityId: row.id,
        action: "opportunity.created",
        diff: { stageId: stage.id, title: input.title },
        ip: req.ip,
      });
      return loadOpportunity(tx, row.id);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin", "agent")
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Opportunity> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchOpportunityRequestSchema, body);
    return db.run(async (tx) => {
      const [before] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).for("update");
      if (!before) throw new NotFoundError();
      if (before.lockVersion !== input.lockVersion) throw modified("Opportunity");
      if (input.ownerId) await assertMember(tx, input.ownerId, "Owner");
      const set: Partial<typeof opportunities.$inferInsert> = {};
      const diff: Record<string, unknown> = {};
      if (input.title !== undefined && input.title !== before.title) {
        set.title = input.title;
        diff["title"] = { from: before.title, to: input.title };
      }
      if (input.valueMinor !== undefined) {
        set.valueMinor = input.valueMinor === null ? null : BigInt(input.valueMinor);
        diff["valueMinor"] = { from: before.valueMinor === null ? null : toNumReq(before.valueMinor), to: input.valueMinor };
      }
      if (input.ownerId !== undefined && input.ownerId !== before.ownerUserId) {
        set.ownerUserId = input.ownerId;
        diff["ownerId"] = { from: before.ownerUserId, to: input.ownerId };
      }
      if (input.nextActionAt !== undefined) {
        set.nextActionAt = input.nextActionAt === null ? null : new Date(input.nextActionAt);
        diff["nextActionAt"] = { from: iso(before.nextActionAt), to: input.nextActionAt };
      }
      if (Object.keys(diff).length === 0) return loadOpportunity(tx, id);
      const [updated] = await tx
        .update(opportunities)
        .set({ ...set, lockVersion: sql`${opportunities.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(opportunities.id, id), eq(opportunities.lockVersion, input.lockVersion)))
        .returning({ id: opportunities.id });
      if (!updated) throw modified("Opportunity");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "opportunity", entityId: id, action: "opportunity.updated", diff, ip: req.ip });
      return loadOpportunity(tx, id);
    });
  }

  @Post(":id/move")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async move(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Opportunity> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(moveOpportunityRequestSchema, body);
    return db.run(async (tx) => {
      const [before] = await tx.select().from(opportunities).where(eq(opportunities.id, id)).for("update");
      if (!before) throw new NotFoundError();
      if (before.lockVersion !== input.lockVersion) throw modified("Opportunity");
      const [stage] = await tx.select().from(pipelineStages).where(eq(pipelineStages.id, input.stageId));
      if (!stage || stage.pipelineId !== before.pipelineId) throw new ValidationError("Stage does not belong to the opportunity's pipeline");
      if (stage.kind === "lost" && !input.lostReason) {
        throw new ValidationError("Validation failed", { details: [{ path: "lostReason", message: "lostReason is required for a lost stage" }] });
      }
      if (stage.id === before.stageId) return loadOpportunity(tx, id);
      const now = new Date();
      const [updated] = await tx
        .update(opportunities)
        .set({
          stageId: stage.id,
          wonAt: stage.kind === "won" ? now : null,
          lostAt: stage.kind === "lost" ? now : null,
          lostReason: stage.kind === "lost" ? (input.lostReason ?? null) : null,
          lockVersion: sql`${opportunities.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(and(eq(opportunities.id, id), eq(opportunities.lockVersion, input.lockVersion)))
        .returning({ id: opportunities.id });
      if (!updated) throw new ConflictError("Opportunity was modified; reload and retry");
      await tx.insert(opportunityStageHistory).values({
        tenantId: db.tenantId,
        opportunityId: id,
        fromStageId: before.stageId,
        toStageId: stage.id,
        changedByType: "user",
        changedBy: db.userId,
        reason: stage.kind === "lost" ? (input.lostReason ?? null) : null,
      });
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "opportunity",
        entityId: id,
        action: "opportunity.moved",
        diff: { stageId: { from: before.stageId, to: stage.id }, kind: stage.kind, ...(input.lostReason ? { lostReason: input.lostReason } : {}) },
        ip: req.ip,
      });
      return loadOpportunity(tx, id);
    });
  }
}
