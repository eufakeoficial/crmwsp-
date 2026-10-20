import { Body, Controller, Get, HttpCode, Param, Patch, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  listContactBookQuerySchema,
  patchContactTagsRequestSchema,
  setMarketingConsentRequestSchema,
  type ContactBookDetail,
  type ContactBookItem,
  type ContactBookList,
  type MarketingConsentStatus,
} from "@crmwsp/contracts";
import {
  and,
  consents,
  contacts,
  conversations,
  desc,
  eq,
  ilike,
  inArray,
  isUuid,
  or,
  orders,
  quotes,
  sql,
  type Contact as ContactRow,
  type Transaction,
} from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { decodeCursor, encodeCursor } from "../inbox/cursor.js";

const CREATED_US = sql`(extract(epoch from ${contacts.createdAt}) * 1000000)::bigint`;
const OPEN_ORDER_STATUSES = ["draft", "pending_payment", "paid", "fulfilled", "shipped"] as const;
const OPEN_QUOTE_STATUSES = ["draft", "pending_approval", "approved", "sent"] as const;
const DOC_LIMIT = 10;

const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
const normalizeTags = (tags: string[]): string[] => [...new Set(tags.map((t) => t.trim()).filter(Boolean))];

/** Adds latest conversation and marketing consent to a page of contacts (one query each). */
async function toItems(tx: Transaction, rows: ContactRow[]): Promise<ContactBookItem[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const convs = await tx
    .select({ id: conversations.id, contactId: conversations.contactId, lastMessageAt: conversations.lastMessageAt })
    .from(conversations)
    .where(inArray(conversations.contactId, ids))
    .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt));
  const latest = new Map<string, { id: string; lastMessageAt: Date | null }>();
  for (const c of convs) if (!latest.has(c.contactId)) latest.set(c.contactId, c);
  const cons = await tx
    .select({ contactId: consents.contactId, status: consents.status })
    .from(consents)
    .where(and(inArray(consents.contactId, ids), eq(consents.kind, "marketing")));
  const consentOf = new Map(cons.map((c) => [c.contactId, c.status] as const));
  return rows.map((c) => {
    const conv = latest.get(c.id);
    return {
      id: c.id,
      name: c.name,
      phoneE164: c.phoneE164,
      tags: c.tags,
      marketingConsent: (consentOf.get(c.id) ?? "none") as MarketingConsentStatus,
      conversationId: conv?.id ?? null,
      lastMessageAt: conv?.lastMessageAt?.toISOString() ?? null,
      createdAt: c.createdAt.toISOString(),
    };
  });
}

async function loadItem(tx: Transaction, id: string): Promise<ContactBookItem> {
  const [row] = await tx.select().from(contacts).where(eq(contacts.id, id));
  if (!row) throw new NotFoundError();
  const [item] = await toItems(tx, [row]);
  if (!item) throw new NotFoundError();
  return item;
}

interface DocRow {
  id: string;
  number: string;
  status: string;
  currency: string;
  totalMinor: bigint;
  createdAt: Date;
}
const toDoc = (r: DocRow) => ({
  id: r.id,
  number: r.number,
  status: r.status,
  currency: r.currency,
  totalMinor: Number(r.totalMinor),
  createdAt: r.createdAt.toISOString(),
});

@Controller("contact-book")
@UseGuards(TenantGuard)
export class ContactBookController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<ContactBookList> {
    const q = parseOrThrow(listContactBookQuerySchema, query);
    const pattern = q.q ? `%${likeEscape(q.q)}%` : undefined;
    const where = [pattern ? or(ilike(contacts.name, pattern), ilike(contacts.phoneE164, pattern)) : undefined];
    if (q.cursor) {
      const cur = decodeCursor(q.cursor);
      where.push(sql`(${CREATED_US}, ${contacts.id}) < (${cur.t}::bigint, ${cur.id}::uuid)`);
    }
    return db.run(async (tx) => {
      const rows = await tx
        .select({ c: contacts, us: sql<string>`${CREATED_US}::text` })
        .from(contacts)
        .where(and(...where))
        .orderBy(desc(CREATED_US), desc(contacts.id))
        .limit(q.limit + 1);
      const page = rows.slice(0, q.limit);
      const last = page[page.length - 1];
      return {
        items: await toItems(tx, page.map((r) => r.c)),
        nextCursor: rows.length > q.limit && last ? encodeCursor({ t: last.us, id: last.c.id }) : null,
      };
    });
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<ContactBookDetail> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const item = await loadItem(tx, id);
      const orderRows = await tx.select().from(orders).where(eq(orders.contactId, id)).orderBy(desc(orders.createdAt)).limit(DOC_LIMIT);
      const quoteRows = await tx.select().from(quotes).where(eq(quotes.contactId, id)).orderBy(desc(quotes.createdAt)).limit(DOC_LIMIT);
      const [openOrders] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(eq(orders.contactId, id), inArray(orders.status, [...OPEN_ORDER_STATUSES])));
      const [openQuotes] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(quotes)
        .where(and(eq(quotes.contactId, id), inArray(quotes.status, [...OPEN_QUOTE_STATUSES])));
      return {
        ...item,
        openOrdersCount: openOrders?.n ?? 0,
        openQuotesCount: openQuotes?.n ?? 0,
        orders: orderRows.map(toDoc),
        quotes: quoteRows.map(toDoc),
      };
    });
  }

  @Patch(":id/tags")
  @Roles("owner", "admin", "agent")
  async setTags(
    @CurrentTenantDb() db: TenantDb,
    @Req() req: HttpRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ContactBookItem> {
    if (!isUuid(id)) throw new NotFoundError();
    const tags = normalizeTags(parseOrThrow(patchContactTagsRequestSchema, body).tags);
    return db.run(async (tx) => {
      const [before] = await tx.select({ tags: contacts.tags }).from(contacts).where(eq(contacts.id, id));
      if (!before) throw new NotFoundError();
      await tx.update(contacts).set({ tags, updatedAt: new Date() }).where(eq(contacts.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "contact",
        entityId: id,
        action: "contact.tags_updated",
        diff: { before: before.tags, after: tags },
        ip: req.ip,
      });
      return loadItem(tx, id);
    });
  }

  /** Manual opt-in/out by an agent. Evidence records the source so it stays auditable. */
  @Put(":id/marketing-consent")
  @HttpCode(200)
  @Roles("owner", "admin", "agent")
  async setMarketingConsent(
    @CurrentTenantDb() db: TenantDb,
    @Req() req: HttpRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ContactBookItem> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(setMarketingConsentRequestSchema, body);
    const now = new Date();
    const status = input.granted ? "granted" : "revoked";
    return db.run(async (tx) => {
      const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, id));
      if (!c) throw new NotFoundError();
      const evidence = { source: "manual_agent" };
      await tx
        .insert(consents)
        .values({
          tenantId: db.tenantId,
          contactId: id,
          kind: "marketing",
          status,
          evidence,
          grantedAt: input.granted ? now : null,
          revokedAt: input.granted ? null : now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [consents.tenantId, consents.contactId, consents.kind],
          set: { status, evidence, updatedAt: now, ...(input.granted ? { grantedAt: now, revokedAt: null } : { revokedAt: now }) },
        });
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "contact",
        entityId: id,
        action: input.granted ? "contact.marketing_granted" : "contact.marketing_revoked",
        ip: req.ip,
      });
      return loadItem(tx, id);
    });
  }
}
