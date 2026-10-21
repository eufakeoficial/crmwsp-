import { Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from "@nestjs/common";
import { ConflictError, NotFoundError, type PublicQuote } from "@crmwsp/contracts";
import { auditEvents, eq, quoteItems, quotes, sql, tenants, type Transaction, withTenant } from "@crmwsp/db";
import { Public } from "../auth/decorators.js";
import { type RateLimitOptions, StoreRateLimiter } from "../auth/rate-limiter.js";
import { clientIp } from "../common/client-ip.js";
import { RATE_LIMIT_STORE, type CounterStore, defaultRateLimitStore } from "../common/rate-limit-store.js";
import { DB_HANDLE, type DbHandle, type HttpRequest } from "../common/http.js";
import { parseAcceptToken } from "./quote.service.js";
import { iso, toNumReq } from "./util.js";

export const PUBLIC_QUOTE_RATE_LIMIT = Symbol("PUBLIC_QUOTE_RATE_LIMIT");
/** Per client IP; the token space (256 bits) already makes guessing infeasible. */
export const DEFAULT_PUBLIC_QUOTE_RATE_LIMIT: RateLimitOptions = { limit: 120, windowMs: 60_000 };

/**
 * Public acceptance page of a sent quote. Tenant-scoped like everything else: the token is
 * `<tenantId>.<secret>`, the tenant id selects the RLS context and only sha256(secret) is stored.
 */
@Controller("public/quotes")
@Public()
export class PublicQuotesController {
  private readonly limiter: StoreRateLimiter;

  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(PUBLIC_QUOTE_RATE_LIMIT) limit: RateLimitOptions,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: CounterStore,
  ) {
    this.limiter = new StoreRateLimiter(limit, store ?? defaultRateLimitStore(), "pq");
  }

  @Get(":token")
  async view(@Param("token") token: string, @Req() req: HttpRequest): Promise<PublicQuote> {
    await this.limiter.consume(clientIp(req));
    return this.inTenant(token, (tx, quoteId) => this.summary(tx, quoteId));
  }

  @Post(":token/accept")
  @HttpCode(200)
  async accept(@Param("token") token: string, @Req() req: HttpRequest): Promise<PublicQuote> {
    await this.limiter.consume(clientIp(req));
    const ip = clientIp(req);
    return this.inTenant(token, async (tx, quoteId, tenantId) => {
      const [q] = await tx.select({ status: quotes.status, valid: sql<boolean>`${quotes.validUntil} > now()` }).from(quotes).where(eq(quotes.id, quoteId)).for("update");
      if (!q) throw new NotFoundError();
      if (q.status === "accepted") return this.summary(tx, quoteId); // idempotent
      if (q.status !== "sent") throw new ConflictError("This quote can no longer be accepted", { details: { reason: q.status } });
      if (!q.valid) throw new ConflictError("This quote has expired", { details: { reason: "expired" } });
      await tx.update(quotes).set({ status: "accepted", acceptedAt: new Date(), lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: new Date() }).where(eq(quotes.id, quoteId));
      await tx.insert(auditEvents).values({
        tenantId,
        actorType: "system",
        entity: "quote",
        entityId: quoteId,
        action: "quote.accepted_by_link",
        // audit_actor_type has no 'public' value: the public link is recorded as system + actor=public.
        diff: { status: { from: "sent", to: "accepted" }, actor: "public" },
        ip: ip === "unknown" ? null : ip,
      });
      return this.summary(tx, quoteId);
    });
  }

  /** Resolves the token inside the token's tenant; every miss is the same 404. */
  private async inTenant<T>(token: string, fn: (tx: Transaction, quoteId: string, tenantId: string) => Promise<T>): Promise<T> {
    const parsed = parseAcceptToken(token);
    if (!parsed) throw new NotFoundError();
    return withTenant(this.handle.db, parsed.tenantId, async (tx) => {
      const [row] = await tx.select({ id: quotes.id }).from(quotes).where(eq(quotes.acceptTokenHash, parsed.hash));
      if (!row) throw new NotFoundError();
      return fn(tx, row.id, parsed.tenantId);
    });
  }

  private async summary(tx: Transaction, quoteId: string): Promise<PublicQuote> {
    const [q] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!q) throw new NotFoundError();
    const [t] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, q.tenantId));
    const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, quoteId)).orderBy(quoteItems.position);
    return {
      number: q.number,
      status: q.status,
      seller: t?.name ?? "",
      currency: q.currency,
      items: items.map((i) => ({
        description: i.description,
        quantityMilli: toNumReq(i.quantityMilli),
        unit: i.unit ?? "ud",
        unitPriceMinor: toNumReq(i.unitPriceMinor),
        discountBp: i.discountBp,
        lineTotalMinor: toNumReq(i.lineTotalMinor),
      })),
      subtotalMinor: toNumReq(q.subtotalMinor),
      discountMinor: toNumReq(q.discountMinor),
      taxMinor: toNumReq(q.taxMinor),
      totalMinor: toNumReq(q.totalMinor),
      validUntil: iso(q.validUntil) as string,
      notes: q.notes,
      terms: q.terms,
      canAccept: q.status === "sent" && q.validUntil.getTime() > Date.now(),
    };
  }
}
