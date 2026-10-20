import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  createTaskRequestSchema,
  listTasksQuerySchema,
  patchTaskRequestSchema,
  type Task,
} from "@crmwsp/contracts";
import { eq, isUuid, opportunities, sql, tasks, type Transaction } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { selectTasks } from "./tasks.queries.js";
import { assertMember } from "./util.js";

const TENANT_TZ = sql`(select tz.timezone from tenants tz where tz.id = t.tenant_id)`;
const LOCAL_DAY = sql`(t.due_at at time zone ${TENANT_TZ})::date`;
const LOCAL_TODAY = sql`(now() at time zone ${TENANT_TZ})::date`;

async function loadTask(tx: Transaction, id: string): Promise<Task> {
  const [t] = await selectTasks(tx, [sql`t.id = ${id}`], 1);
  if (!t) throw new NotFoundError();
  return t;
}

@Controller("tasks")
@UseGuards(TenantGuard)
export class TasksController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<{ items: Task[] }> {
    const q = parseOrThrow(listTasksQuerySchema, query);
    const where: Array<ReturnType<typeof sql>> = [];
    if (q.status) where.push(sql`t.status = ${q.status}`);
    if (q.assignedTo === "me") where.push(sql`t.assigned_user_id = ${db.userId}`);
    if (q.due === "overdue") where.push(sql`t.status = 'open' and t.due_at < now()`);
    else if (q.due === "today") where.push(sql`t.due_at is not null and ${LOCAL_DAY} = ${LOCAL_TODAY}`);
    else if (q.due === "week") where.push(sql`t.due_at is not null and ${LOCAL_DAY} between ${LOCAL_TODAY} and ${LOCAL_TODAY} + 6`);
    return { items: await db.run((tx) => selectTasks(tx, where)) };
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Task> {
    const input = parseOrThrow(createTaskRequestSchema, body);
    return db.run(async (tx) => {
      if (input.assignedUserId) await assertMember(tx, input.assignedUserId);
      if (input.opportunityId) {
        const [o] = await tx.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, input.opportunityId));
        if (!o) throw new NotFoundError();
      }
      const [row] = await tx
        .insert(tasks)
        .values({
          tenantId: db.tenantId,
          title: input.title,
          description: input.description ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          assignedUserId: input.assignedUserId ?? null,
          opportunityId: input.opportunityId ?? null,
          origin: "manual",
        })
        .returning({ id: tasks.id });
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "task", entityId: row.id, action: "task.created", diff: { title: input.title }, ip: req.ip });
      return loadTask(tx, row.id);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Task> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchTaskRequestSchema, body);
    return db.run(async (tx) => {
      const [before] = await tx.select().from(tasks).where(eq(tasks.id, id)).for("update");
      if (!before) throw new NotFoundError();
      if (input.assignedUserId) await assertMember(tx, input.assignedUserId);
      const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
      if (input.title !== undefined) set.title = input.title;
      if (input.dueAt !== undefined) set.dueAt = input.dueAt === null ? null : new Date(input.dueAt);
      if (input.assignedUserId !== undefined) set.assignedUserId = input.assignedUserId;
      if (input.status !== undefined && input.status !== before.status) {
        set.status = input.status;
        set.completedAt = input.status === "done" ? new Date() : null;
      }
      if (Object.keys(set).length === 1 && input.status === undefined) throw new ValidationError("Nothing to update");
      await tx.update(tasks).set(set).where(eq(tasks.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "task",
        entityId: id,
        action: "task.updated",
        diff: { ...input },
        ip: req.ip,
      });
      return loadTask(tx, id);
    });
  }
}
