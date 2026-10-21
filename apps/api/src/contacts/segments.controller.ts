import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  contactFilterSchema,
  createContactSegmentRequestSchema,
  updateContactSegmentRequestSchema,
  type ContactFilter,
  type ContactSegment,
} from "@crmwsp/contracts";
import { asc, contactSegments, eq, isUuid, type ContactSegmentRow, type Transaction } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { pgCode, writeAudit } from "../inbox/audit.js";
import { contactFilterWhere, countContacts } from "./contact-query.js";
import { referencedSegmentIds } from "./filter-sql.js";

const MAX_SEGMENTS = 200;

async function toDto(tx: Transaction, r: ContactSegmentRow): Promise<ContactSegment> {
  const parsed = contactFilterSchema.safeParse(r.filter);
  const filter: ContactFilter = parsed.success ? parsed.data : { match: "all", conditions: [] };
  let count = 0;
  try {
    count = parsed.success ? await countContacts(tx, await contactFilterWhere(tx, filter)) : 0;
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
  }
  return { id: r.id, name: r.name, filter, count, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

/** Rejects self references and filters that do not compile (e.g. cycles past the nesting limit). */
async function assertCompiles(tx: Transaction, filter: ContactFilter, selfId?: string): Promise<void> {
  if (selfId && referencedSegmentIds(filter).includes(selfId)) throw new ValidationError("a segment cannot reference itself");
  await contactFilterWhere(tx, filter);
}

const conflictOnName = (err: unknown): never => {
  if (pgCode(err) === "23505") throw new ConflictError("a segment with that name already exists");
  throw err;
};

@Controller("segments")
@UseGuards(TenantGuard)
export class SegmentsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb): Promise<{ items: ContactSegment[] }> {
    return db.run(async (tx) => {
      const rows = await tx.select().from(contactSegments).orderBy(asc(contactSegments.name)).limit(MAX_SEGMENTS);
      const items: ContactSegment[] = [];
      for (const r of rows) items.push(await toDto(tx, r));
      return { items };
    });
  }

  @Get(":id")
  async get(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<ContactSegment> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const [r] = await tx.select().from(contactSegments).where(eq(contactSegments.id, id));
      if (!r) throw new NotFoundError();
      return toDto(tx, r);
    });
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest, @Body() body: unknown): Promise<ContactSegment> {
    const input = parseOrThrow(createContactSegmentRequestSchema, body);
    return db.run(async (tx) => {
      await assertCompiles(tx, input.filter);
      const [row] = await tx
        .insert(contactSegments)
        .values({ tenantId: db.tenantId, name: input.name, filter: input.filter, createdBy: db.userId })
        .returning()
        .catch(conflictOnName);
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "contact_segment", entityId: row.id, action: "segment.created", diff: { name: input.name }, ip: req.ip });
      return toDto(tx, row);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin", "agent")
  async update(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<ContactSegment> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateContactSegmentRequestSchema, body);
    return db.run(async (tx) => {
      if (input.filter) await assertCompiles(tx, input.filter, id);
      const [row] = await tx
        .update(contactSegments)
        .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.filter ? { filter: input.filter } : {}), updatedAt: new Date() })
        .where(eq(contactSegments.id, id))
        .returning()
        .catch(conflictOnName);
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "contact_segment", entityId: id, action: "segment.updated", diff: { name: row.name }, ip: req.ip });
      return toDto(tx, row);
    });
  }

  @Delete(":id")
  @HttpCode(204)
  @Roles("owner", "admin", "agent")
  async remove(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest, @Param("id") id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      const [row] = await tx.delete(contactSegments).where(eq(contactSegments.id, id)).returning({ id: contactSegments.id, name: contactSegments.name });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "contact_segment", entityId: id, action: "segment.deleted", diff: { name: row.name }, ip: req.ip });
    });
  }
}
