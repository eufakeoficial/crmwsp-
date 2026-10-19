import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  listContactsQuerySchema,
  type Contact,
  type ContactListResponse,
} from "@crmwsp/contracts";
import { asc, contacts, eq, ilike, isUuid, or, type Contact as ContactRow } from "@crmwsp/db";
import { CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";

const toDto = (c: ContactRow): Contact => ({
  id: c.id,
  name: c.name,
  phoneE164: c.phoneE164,
  tags: c.tags,
  extracted: c.extracted,
  createdAt: c.createdAt.toISOString(),
  updatedAt: c.updatedAt.toISOString(),
});

/** Escapes LIKE wildcards so user input matches literally. */
const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

@Controller("contacts")
@UseGuards(TenantGuard)
export class ContactsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<ContactListResponse> {
    const q = parseOrThrow(listContactsQuerySchema, query);
    const pattern = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const rows = await db.run((tx) =>
      tx
        .select()
        .from(contacts)
        .where(pattern ? or(ilike(contacts.name, pattern), ilike(contacts.phoneE164, pattern)) : undefined)
        .orderBy(asc(contacts.name), asc(contacts.id))
        .limit(q.limit),
    );
    return { items: rows.map(toDto) };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Contact> {
    if (!isUuid(id)) throw new NotFoundError();
    const [row] = await db.run((tx) => tx.select().from(contacts).where(eq(contacts.id, id)));
    if (!row) throw new NotFoundError();
    return toDto(row);
  }
}
