import { Body, Controller, Get, HttpCode, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  aiActionDecisionRequestSchema,
  aiActionsQuerySchema,
  type AiActionItem,
  type AiActionItemList,
} from "@crmwsp/contracts";
import {
  actionApprovals,
  aiActions,
  and,
  contacts,
  conversations,
  desc,
  eq,
  inArray,
  isUuid,
  sql,
  knowledgeChunks,
  knowledgeSources,
  quotes,
  type AiAction,
  type Transaction,
} from "@crmwsp/db";
import type { Queue } from "bullmq";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { AI_JOB_OPTIONS, AI_QUEUE, EXECUTE_AI_ACTION_JOB, type ExecuteAiActionJobData } from "./ai.constants.js";

const LIST_LIMIT = 200;
const EXCERPT_CHARS = 240;

type Decision = "approved" | "rejected";

/** Citations come from the stored JSON; title/excerpt are filled from the cited chunk when it still exists. */
async function citationsFor(tx: Transaction, actions: AiAction[]): Promise<Map<string, AiActionItem["citations"][number]>> {
  const ids = [...new Set(actions.flatMap((a) => a.citations.map((c) => c.chunkId)))].filter(isUuid);
  const out = new Map<string, AiActionItem["citations"][number]>();
  if (ids.length === 0) return out;
  const rows = await tx
    .select({ id: knowledgeChunks.id, content: knowledgeChunks.content, title: knowledgeSources.title })
    .from(knowledgeChunks)
    .innerJoin(knowledgeSources, eq(knowledgeSources.id, knowledgeChunks.sourceId))
    .where(inArray(knowledgeChunks.id, ids));
  for (const r of rows) out.set(r.id, { chunkId: r.id, title: r.title, excerpt: r.content.slice(0, EXCERPT_CHARS) });
  return out;
}

@Controller("ai/actions")
@UseGuards(TenantGuard)
export class AiActionsController {
  constructor(@Inject(AI_QUEUE) private readonly queue: Queue) {}

  @Get()
  @Roles("owner", "admin", "agent")
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<AiActionItemList> {
    const { status, type, conversationId } = parseOrThrow(aiActionsQuerySchema, query);
    return db.run(async (tx) => {
      const rows = await tx
        .select({ action: aiActions, contactName: contacts.name, contactPhone: contacts.phoneE164 })
        .from(aiActions)
        .leftJoin(conversations, eq(conversations.id, aiActions.conversationId))
        .leftJoin(contacts, eq(contacts.id, conversations.contactId))
        .where(
          and(
            status ? eq(aiActions.status, status) : undefined,
            type ? eq(aiActions.type, type) : undefined,
            conversationId ? eq(aiActions.conversationId, conversationId) : undefined,
          ),
        )
        .orderBy(desc(aiActions.createdAt), desc(aiActions.id))
        .limit(LIST_LIMIT);
      const cited = await citationsFor(tx, rows.map((r) => r.action));
      return {
        items: rows.map(({ action: a, contactName, contactPhone }) => ({
          id: a.id,
          type: a.type,
          status: a.status,
          conversationId: a.conversationId,
          contactName: contactName ?? contactPhone ?? null,
          payload: a.payload,
          reason: a.decisionReason,
          citations: a.citations.map((c) => cited.get(c.chunkId) ?? { chunkId: c.chunkId }),
          createdAt: a.createdAt.toISOString(),
        })),
      };
    });
  }

  @Post(":id/approve")
  @Roles("owner", "admin")
  @HttpCode(200)
  async approve(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<{ id: string; status: string }> {
    const result = await this.decide(db, id, "approved", body, req);
    // Approval does not execute: the worker does. Enqueued after commit; jobId dedupes retries.
    const data: ExecuteAiActionJobData = { tenantId: db.tenantId, actionId: id };
    await this.queue.add(EXECUTE_AI_ACTION_JOB, data, { ...AI_JOB_OPTIONS, jobId: `execute-${id}` });
    return result;
  }

  @Post(":id/reject")
  @Roles("owner", "admin")
  @HttpCode(200)
  async reject(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<{ id: string; status: string }> {
    return this.decide(db, id, "rejected", body, req);
  }

  /** Same rules for both: only `pending_approval` can be decided (409 otherwise); decision + status + audit in one transaction. */
  private async decide(db: TenantDb, id: string, decision: Decision, body: unknown, req: HttpRequest): Promise<{ id: string; status: string }> {
    if (!isUuid(id)) throw new NotFoundError();
    const { note } = parseOrThrow(aiActionDecisionRequestSchema, body ?? {});
    return db.run(async (tx) => {
      const [action] = await tx.select().from(aiActions).where(eq(aiActions.id, id)).for("update");
      if (!action) throw new NotFoundError();
      if (action.status !== "pending_approval") throw new ConflictError(`Action is ${action.status}, not pending approval`);
      await tx.insert(actionApprovals).values({
        tenantId: db.tenantId,
        actionId: id,
        decidedBy: db.userId,
        decision,
        note: note ?? null,
      });
      await tx.update(aiActions).set({ status: decision }).where(eq(aiActions.id, id));
      // Quote approval records (POST /quotes/:id/submit) carry the quote id: a rejection here rejects the quote too.
      // An approval is applied to the quote by the worker (execute-ai-action).
      const quoteId = action.type === "create_quote_draft" ? action.payload["quoteId"] : undefined;
      if (decision === "rejected" && isUuid(quoteId)) {
        await tx
          .update(quotes)
          .set({ status: "rejected", lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(quotes.id, quoteId), eq(quotes.status, "pending_approval")));
      }
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "ai_action",
        entityId: id,
        action: decision === "approved" ? "ai_action.approved" : "ai_action.rejected",
        diff: { status: { from: "pending_approval", to: decision }, type: action.type, ...(note ? { note } : {}) },
        ip: req.ip,
      });
      return { id, status: decision };
    });
  }
}
