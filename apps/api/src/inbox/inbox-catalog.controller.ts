import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  createCannedResponseRequestSchema,
  createTagRequestSchema,
  listCannedResponsesQuerySchema,
  updateCannedResponseRequestSchema,
  updateTagRequestSchema,
  type CannedResponseDto,
  type CannedResponseListResponse,
  type TagDto,
  type TagListResponse,
} from "@crmwsp/contracts";
import { asc, cannedResponses, eq, ilike, isUuid, or, sql, tags, type CannedResponse, type Tag, type Transaction } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "./audit.js";
import { likeEscape } from "./inbox-v2.scope.js";

const toCanned = (r: CannedResponse): CannedResponseDto => ({
  id: r.id,
  title: r.title,
  body: r.body,
  shortcut: r.shortcut,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

async function contactCounts(tx: Transaction): Promise<Map<string, number>> {
  const rows = await tx.execute<{ name: string; count: number }>(
    sql`select t.name, count(*)::int as count from contacts ct, unnest(ct.tags) as t(name) group by t.name`,
  );
  return new Map(rows.map((r) => [r.name, Number(r.count)]));
}

const toTag = (r: Tag, counts: Map<string, number>): TagDto => ({
  id: r.id,
  name: r.name,
  emoji: r.emoji,
  color: r.color,
  contactCount: counts.get(r.name) ?? 0,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

const conflictOnUnique = (what: string) => (err: unknown) => {
  if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError(`${what} already exists`);
  throw err;
};

/**
 * Tag catalog (emoji + color over the `contacts.tags` strings) and canned responses (T23).
 * The catalog never replaces the strings: contact filters keep matching on `contacts.tags`.
 */
@Controller("inbox")
@UseGuards(TenantGuard)
export class InboxCatalogController {
  @Get("tags")
  async listTags(@CurrentTenantDb() db: TenantDb): Promise<TagListResponse> {
    return db.run(async (tx) => {
      const rows = await tx.select().from(tags).orderBy(asc(tags.name));
      const counts = await contactCounts(tx);
      return { items: rows.map((r) => toTag(r, counts)) };
    });
  }

  @Post("tags")
  @Roles("owner", "admin", "agent")
  @HttpCode(201)
  async createTag(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<TagDto> {
    const input = parseOrThrow(createTagRequestSchema, body);
    return db
      .run(async (tx) => {
        const [row] = await tx
          .insert(tags)
          .values({ tenantId: db.tenantId, name: input.name, emoji: input.emoji ?? null, color: input.color ?? null })
          .returning();
        if (!row) throw new Error("tag insert returned no row");
        return toTag(row, await contactCounts(tx));
      })
      .catch(conflictOnUnique("Tag"));
  }

  /** Renaming rewrites the string on every contact so existing links survive. */
  @Patch("tags/:id")
  @Roles("owner", "admin", "agent")
  async updateTag(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<TagDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateTagRequestSchema, body);
    return db
      .run(async (tx) => {
        const [before] = await tx.select().from(tags).where(eq(tags.id, id)).for("update");
        if (!before) throw new NotFoundError();
        const [row] = await tx
          .update(tags)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.emoji !== undefined ? { emoji: input.emoji } : {}),
            ...(input.color !== undefined ? { color: input.color } : {}),
            updatedAt: new Date(),
          })
          .where(eq(tags.id, id))
          .returning();
        if (!row) throw new NotFoundError();
        if (input.name !== undefined && input.name !== before.name) {
          // array_remove first avoids a duplicate when a contact already carries the new name.
          await tx.execute(sql`
            update contacts set tags = array_append(array_remove(array_remove(tags, ${before.name}), ${input.name}), ${input.name}),
                   updated_at = now()
            where ${before.name} = any(tags)`);
          await writeAudit(tx, {
            tenantId: db.tenantId,
            userId: db.userId,
            entity: "tag",
            entityId: id,
            action: "tag.renamed",
            diff: { name: { from: before.name, to: input.name } },
            ip: req.ip,
          });
        }
        return toTag(row, await contactCounts(tx));
      })
      .catch(conflictOnUnique("Tag"));
  }

  /** Deletes the catalog entry and removes the tag string from every contact. */
  @Delete("tags/:id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async deleteTag(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db.run(async (tx) => {
      const [row] = await tx.delete(tags).where(eq(tags.id, id)).returning({ name: tags.name });
      if (!row) throw new NotFoundError();
      await tx.execute(sql`update contacts set tags = array_remove(tags, ${row.name}), updated_at = now() where ${row.name} = any(tags)`);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tag",
        entityId: id,
        action: "tag.deleted",
        diff: { name: row.name },
        ip: req.ip,
      });
    });
  }

  @Get("canned-responses")
  async listCanned(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<CannedResponseListResponse> {
    const q = parseOrThrow(listCannedResponsesQuerySchema, query);
    const pattern = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const rows = await db.run((tx) =>
      tx
        .select()
        .from(cannedResponses)
        .where(
          pattern
            ? or(ilike(cannedResponses.title, pattern), ilike(cannedResponses.shortcut, pattern), ilike(cannedResponses.body, pattern))
            : undefined,
        )
        .orderBy(asc(cannedResponses.title), asc(cannedResponses.id))
        .limit(500),
    );
    return { items: rows.map(toCanned) };
  }

  @Post("canned-responses")
  @Roles("owner", "admin", "agent")
  @HttpCode(201)
  async createCanned(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<CannedResponseDto> {
    const input = parseOrThrow(createCannedResponseRequestSchema, body);
    const [row] = await db
      .run((tx) =>
        tx
          .insert(cannedResponses)
          .values({
            tenantId: db.tenantId,
            title: input.title,
            body: input.body,
            shortcut: input.shortcut ?? null,
            createdBy: db.userId,
          })
          .returning(),
      )
      .catch(conflictOnUnique("Shortcut"));
    if (!row) throw new Error("canned response insert returned no row");
    return toCanned(row);
  }

  @Patch("canned-responses/:id")
  @Roles("owner", "admin", "agent")
  async updateCanned(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown): Promise<CannedResponseDto> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(updateCannedResponseRequestSchema, body);
    const [row] = await db
      .run((tx) =>
        tx
          .update(cannedResponses)
          .set({
            ...(input.title !== undefined ? { title: input.title } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.shortcut !== undefined ? { shortcut: input.shortcut } : {}),
            updatedAt: new Date(),
          })
          .where(eq(cannedResponses.id, id))
          .returning(),
      )
      .catch(conflictOnUnique("Shortcut"));
    if (!row) throw new NotFoundError();
    return toCanned(row);
  }

  @Delete("canned-responses/:id")
  @Roles("owner", "admin", "agent")
  @HttpCode(204)
  async deleteCanned(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    const [row] = await db.run((tx) => tx.delete(cannedResponses).where(eq(cannedResponses.id, id)).returning({ id: cannedResponses.id }));
    if (!row) throw new NotFoundError();
  }
}
