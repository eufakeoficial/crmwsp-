import { randomUUID } from "node:crypto";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  OutsideServiceWindowError,
  SERVICE_WINDOW_MS,
  ValidationError,
  createQuoteRequestSchema,
  listQuotesQuerySchema,
  patchQuoteRequestSchema,
  shippingAddressSchema,
  type Order,
  type Quote,
  type QuoteAcceptLink,
  type QuoteList,
} from "@crmwsp/contracts";
import {
  actionApprovals,
  aiActions,
  and,
  contacts,
  conversations,
  desc,
  eq,
  isUuid,
  messages,
  opportunities,
  orders,
  productVariants,
  products,
  quoteItems,
  quotes,
  sql,
  tenants,
} from "@crmwsp/db";
import { formatMoney, renderQuotePdf } from "@crmwsp/pdf";
import type { Queue } from "bullmq";
import { z } from "zod";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { type HttpReply, type HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { writeAudit } from "../inbox/audit.js";
import { OUTBOUND_QUEUE, SEND_MESSAGE_JOB, SEND_MESSAGE_JOB_OPTIONS, type SendMessageJobData } from "../inbox/outbound.constants.js";
import { StorageHolder } from "../storage/object-storage.js";
import { assertConversationOfContact, insertOrderDraft, loadOrder, type OrderLine } from "../commerce/orders.service.js";
import {
  approvalThreshold,
  loadQuote,
  lockQuote,
  needsApproval,
  newAcceptToken,
  nextNumber,
  replaceItems,
  resolveLines,
  selectQuotes,
  totalsOf,
  variantLabel,
  buildLine,
  type Role,
} from "./quote.service.js";
import { modified, toNumReq } from "./util.js";

const decisionBodySchema = z.object({ note: z.string().trim().max(500).optional() }).optional();
const convertBodySchema = z
  .object({
    fulfillment: z.enum(["shipping", "pickup", "digital", "service"]).default("service"),
    shippingAddress: shippingAddressSchema.optional(),
    shippingMinor: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === "shipping" && !v.shippingAddress) {
      ctx.addIssue({ code: "custom", path: ["shippingAddress"], message: "shippingAddress is required for shipping" });
    }
  });

const sellerSettingsSchema = z
  .object({
    taxId: z.string().max(50).optional(),
    address: z.string().max(400).optional(),
    phone: z.string().max(50).optional(),
    email: z.string().max(200).optional(),
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  })
  .partial();

const webBase = (): string =>
  (process.env["PUBLIC_WEB_URL"] ?? (process.env["WEB_ORIGINS"] ?? "").split(",")[0]?.trim() ?? "").replace(/\/+$/, "") || "http://localhost:3000";

@Controller("quotes")
@UseGuards(TenantGuard)
export class QuotesController {
  constructor(
    @Inject(OUTBOUND_QUEUE) private readonly queue: Queue,
    @Inject(RealtimeHub) private readonly hub: RealtimeHub,
    @Inject(StorageHolder) private readonly storage: StorageHolder,
  ) {}

  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<QuoteList> {
    const q = parseOrThrow(listQuotesQuerySchema, query);
    const items = await db.run((tx) =>
      selectQuotes(tx, [q.status ? eq(quotes.status, q.status) : undefined, q.opportunityId ? eq(quotes.opportunityId, q.opportunityId) : undefined]),
    );
    return { items };
  }

  @Get(":id")
  async detail(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Quote> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run((tx) => loadQuote(tx, id));
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: { role: Role }, @Body() body: unknown, @Req() req: HttpRequest): Promise<Quote> {
    const input = parseOrThrow(createQuoteRequestSchema, body);
    return db.run(async (tx) => {
      const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
      if (!contact) throw new NotFoundError();
      let conversationId: string | null = input.conversationId ?? null;
      if (input.opportunityId) {
        const [opp] = await tx
          .select({ contactId: opportunities.contactId, conversationId: opportunities.conversationId })
          .from(opportunities)
          .where(eq(opportunities.id, input.opportunityId));
        if (!opp) throw new NotFoundError();
        if (opp.contactId !== input.contactId) throw new ValidationError("The opportunity belongs to another contact");
        conversationId ??= opp.conversationId;
      }
      if (input.conversationId) await assertConversationOfContact(tx, input.conversationId, input.contactId);
      const { lines, overrides } = await resolveLines(tx, input.items, input.currency, tenant.role);
      const totals = totalsOf(lines);
      const number = await nextNumber(tx, "quote");
      const [row] = await tx
        .insert(quotes)
        .values({
          tenantId: db.tenantId,
          number,
          opportunityId: input.opportunityId ?? null,
          contactId: input.contactId,
          conversationId,
          status: "draft",
          currency: input.currency,
          subtotalMinor: totals.subtotal,
          discountMinor: totals.discount,
          taxMinor: totals.tax,
          totalMinor: totals.total,
          validUntil: new Date(input.validUntil),
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          createdByType: "user",
        })
        .returning({ id: quotes.id });
      if (!row) throw new Error("insert returned no row");
      await replaceItems(tx, db.tenantId, row.id, lines);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "quote",
        entityId: row.id,
        action: "quote.created",
        diff: { number, totalMinor: Number(totals.total), ...(overrides.length ? { priceOverrides: overrides } : {}) },
        ip: req.ip,
      });
      return loadQuote(tx, row.id);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin", "agent")
  async patch(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: { role: Role },
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Quote> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchQuoteRequestSchema, body);
    return db.run(async (tx) => {
      const before = await lockQuote(tx, id);
      if (before.lockVersion !== input.lockVersion) throw modified("Quote");
      if (before.status !== "draft") throw new ConflictError("Only draft quotes can be edited");
      const contactId = input.contactId ?? before.contactId;
      if (input.contactId) {
        const [c] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
        if (!c) throw new NotFoundError();
      }
      const opportunityId = input.opportunityId === undefined ? before.opportunityId : input.opportunityId;
      if (opportunityId) {
        const [opp] = await tx.select({ contactId: opportunities.contactId }).from(opportunities).where(eq(opportunities.id, opportunityId));
        if (!opp) throw new NotFoundError();
        if (opp.contactId !== contactId) throw new ValidationError("The opportunity belongs to another contact");
      }
      const currency = input.currency ?? before.currency;
      if (currency !== before.currency && !input.items) throw new ValidationError("Changing the currency requires resending the items");

      const set: Partial<typeof quotes.$inferInsert> = { contactId, opportunityId, currency };
      let overrides: unknown[] = [];
      if (input.validUntil !== undefined) set.validUntil = new Date(input.validUntil);
      if (input.notes !== undefined) set.notes = input.notes;
      if (input.terms !== undefined) set.terms = input.terms;
      if (input.items) {
        const r = await resolveLines(tx, input.items, currency, tenant.role);
        overrides = r.overrides;
        const totals = totalsOf(r.lines);
        Object.assign(set, {
          subtotalMinor: totals.subtotal,
          discountMinor: totals.discount,
          taxMinor: totals.tax,
          totalMinor: totals.total,
        });
        await replaceItems(tx, db.tenantId, id, r.lines);
      }
      const [updated] = await tx
        .update(quotes)
        .set({ ...set, lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(quotes.id, id), eq(quotes.lockVersion, input.lockVersion)))
        .returning({ id: quotes.id });
      if (!updated) throw modified("Quote");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "quote",
        entityId: id,
        action: "quote.updated",
        diff: { itemsReplaced: Boolean(input.items), ...(overrides.length ? { priceOverrides: overrides } : {}) },
        ip: req.ip,
      });
      return loadQuote(tx, id);
    });
  }

  /** draft -> approved, or pending_approval (+ an `ai_actions` approval record) above the threshold / with discounts. */
  @Post(":id/submit")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async submit(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Quote> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const q = await lockQuote(tx, id);
      if (q.status !== "draft") throw new ConflictError(`Cannot submit a quote that is ${q.status}`);
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(quoteItems).where(eq(quoteItems.quoteId, id));
      if (!n?.n) throw new ValidationError("The quote has no items");
      const threshold = await approvalThreshold(tx);
      const approval = needsApproval(q.totalMinor, q.discountMinor, threshold);
      const now = new Date();
      let actionId: string | null = null;
      if (approval) {
        const reason = q.discountMinor > 0n ? "quote_has_discount" : "total_above_threshold";
        const [a] = await tx
          .insert(aiActions)
          .values({
            tenantId: db.tenantId,
            conversationId: q.conversationId,
            type: "create_quote_draft",
            payload: { quoteId: id, number: q.number, totalMinor: toNumReq(q.totalMinor), currency: q.currency, reason },
            decision: "approve",
            decisionReason: reason,
            status: "pending_approval",
          })
          .returning({ id: aiActions.id });
        actionId = a?.id ?? null;
      }
      await tx
        .update(quotes)
        .set({
          status: approval ? "pending_approval" : "approved",
          approvalActionId: actionId,
          ...(approval ? {} : { approvedAt: now }),
          lockVersion: sql`${quotes.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(quotes.id, id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "quote",
        entityId: id,
        action: "quote.submitted",
        diff: { status: approval ? "pending_approval" : "approved", approvalActionId: actionId },
        ip: req.ip,
      });
      return loadQuote(tx, id);
    });
  }

  @Post(":id/approve")
  @Roles("owner", "admin")
  @HttpCode(200)
  approve(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Quote> {
    return this.decide(db, id, "approved", body, req);
  }

  @Post(":id/reject")
  @Roles("owner", "admin")
  @HttpCode(200)
  reject(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Quote> {
    return this.decide(db, id, "rejected", body, req);
  }

  private async decide(db: TenantDb, id: string, decision: "approved" | "rejected", body: unknown, req: HttpRequest): Promise<Quote> {
    if (!isUuid(id)) throw new NotFoundError();
    const note = parseOrThrow(decisionBodySchema, body ?? undefined)?.note;
    return db.run(async (tx) => {
      const q = await lockQuote(tx, id);
      if (q.status !== "pending_approval") throw new ConflictError(`Quote is ${q.status}, not pending approval`);
      const now = new Date();
      await tx
        .update(quotes)
        .set({
          status: decision,
          ...(decision === "approved" ? { approvedBy: db.userId, approvedAt: now } : {}),
          lockVersion: sql`${quotes.lockVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(quotes.id, id));
      if (q.approvalActionId) {
        const [a] = await tx.select({ status: aiActions.status }).from(aiActions).where(eq(aiActions.id, q.approvalActionId)).for("update");
        if (a?.status === "pending_approval") {
          await tx.insert(actionApprovals).values({ tenantId: db.tenantId, actionId: q.approvalActionId, decidedBy: db.userId, decision, note: note ?? null });
          await tx
            .update(aiActions)
            .set(decision === "approved" ? { status: "executed", executedAt: now, result: { quoteId: id, approved: true } } : { status: "rejected" })
            .where(eq(aiActions.id, q.approvalActionId));
        }
      }
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "quote",
        entityId: id,
        action: decision === "approved" ? "quote.approved" : "quote.rejected",
        diff: { status: { from: "pending_approval", to: decision }, ...(note ? { note } : {}) },
        ip: req.ip,
      });
      return loadQuote(tx, id);
    });
  }

  @Get(":id/pdf")
  async pdf(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Res({ passthrough: true }) reply: HttpReply): Promise<StreamableFile> {
    if (!isUuid(id)) throw new NotFoundError();
    const { quote, tenant } = await db.run(async (tx) => {
      const quote = await loadQuote(tx, id);
      const [tenant] = await tx.select({ name: tenants.name, settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId));
      return { quote, tenant };
    });
    const seller = sellerSettingsSchema.safeParse((tenant?.settings as { seller?: unknown } | undefined)?.seller ?? {});
    const s = seller.success ? seller.data : {};
    const bytes = await renderQuotePdf({
      number: quote.number,
      issueDate: quote.createdAt.slice(0, 10),
      validUntil: quote.validUntil.slice(0, 10),
      currency: quote.currency,
      locale: "es",
      seller: {
        name: tenant?.name ?? "CRMWSP",
        ...(s.taxId ? { taxId: s.taxId } : {}),
        ...(s.address ? { address: s.address } : {}),
        ...(s.phone ? { phone: s.phone } : {}),
        ...(s.email ? { email: s.email } : {}),
      },
      customer: { name: quote.contact.name ?? quote.contact.phoneE164, phone: quote.contact.phoneE164 },
      items: quote.items.map((i) => ({
        description: i.description,
        quantity: i.quantityMilli / 1000,
        unit: i.unit,
        unitPriceMinor: i.unitPriceMinor,
        ...(i.discountBp ? { discountPercent: i.discountBp / 100 } : {}),
        ...(i.taxRateBp ? { taxRatePercent: i.taxRateBp / 100 } : {}),
      })),
      ...(quote.notes ? { notes: quote.notes } : {}),
      ...(quote.terms ? { terms: quote.terms } : {}),
      ...(s.brandColor ? { brandColor: s.brandColor } : {}),
    });
    const body = Buffer.from(bytes);
    // Best effort: keep a copy in object storage when it is configured.
    const storage = this.storage.storage;
    if (storage) {
      const key = `tenants/${db.tenantId}/quotes/${id}.pdf`;
      try {
        await storage.put(key, body, "application/pdf");
        await db.run((tx) => tx.update(quotes).set({ pdfStorageKey: key }).where(eq(quotes.id, id)));
      } catch {
        /* the PDF is still returned */
      }
    }
    reply.header("cache-control", "private, no-store");
    return new StreamableFile(body, { type: "application/pdf", disposition: `inline; filename="${quote.number}.pdf"` });
  }

  /** approved -> sent. Queues an outbound WhatsApp message with the summary and the acceptance link. */
  @Post(":id/send")
  @Roles("owner", "admin", "agent")
  @HttpCode(202)
  async send(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<Quote> {
    if (!isUuid(id)) throw new NotFoundError();
    const { quote, messageId, conversationId } = await db.run(async (tx) => {
      const q = await lockQuote(tx, id);
      if (q.status !== "approved") throw new ConflictError(`Only approved quotes can be sent (this one is ${q.status})`);
      if (q.validUntil.getTime() <= Date.now()) throw new ConflictError("The quote has expired");
      let convId = q.conversationId;
      if (!convId && q.opportunityId) {
        const [o] = await tx.select({ c: opportunities.conversationId }).from(opportunities).where(eq(opportunities.id, q.opportunityId));
        convId = o?.c ?? null;
      }
      if (!convId) {
        const [c] = await tx
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.contactId, q.contactId))
          .orderBy(sql`${conversations.lastMessageAt} desc nulls last`, desc(conversations.createdAt))
          .limit(1);
        convId = c?.id ?? null;
      }
      if (!convId) throw new ValidationError("The contact has no conversation to send the quote to");
      const [conv] = await tx
        .select({
          id: conversations.id,
          // Database clock, like POST /conversations/:id/messages.
          inWindow: sql<boolean>`coalesce(${conversations.lastInboundAt} > now() - make_interval(secs => ${SERVICE_WINDOW_MS / 1000}), false)`,
        })
        .from(conversations)
        .where(eq(conversations.id, convId));
      if (!conv) throw new NotFoundError();
      if (!conv.inWindow) throw new OutsideServiceWindowError();

      const { token, hash } = newAcceptToken(db.tenantId);
      const total = formatMoney(toNumReq(q.totalMinor), q.currency, "es");
      const text = [
        `Presupuesto ${q.number}`,
        `Total: ${total}`,
        `Válido hasta: ${q.validUntil.toISOString().slice(0, 10)}`,
        `Revísalo y acéptalo aquí: ${webBase()}/q/${token}`,
      ].join("\n");
      const [msg] = await tx
        .insert(messages)
        .values({
          tenantId: db.tenantId,
          conversationId: convId,
          direction: "outbound",
          type: "text",
          body: text,
          status: "queued",
          author: "user",
          authorUserId: db.userId,
          clientMessageId: randomUUID(),
        })
        .returning({ id: messages.id, createdAt: messages.createdAt });
      if (!msg) throw new Error("insert returned no row");
      await tx
        .update(conversations)
        .set({
          lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${msg.createdAt.toISOString()}::timestamptz), ${msg.createdAt.toISOString()}::timestamptz)`,
          updatedAt: new Date(),
        })
        .where(eq(conversations.id, convId));
      await tx
        .update(quotes)
        .set({
          status: "sent",
          sentAt: new Date(),
          acceptTokenHash: hash,
          conversationId: convId,
          lockVersion: sql`${quotes.lockVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(quotes.id, id));
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "quote", entityId: id, action: "quote.sent", diff: { messageId: msg.id }, ip: req.ip });
      return { quote: await loadQuote(tx, id), messageId: msg.id, conversationId: convId };
    });
    const data: SendMessageJobData = { tenantId: db.tenantId, messageId };
    await this.queue.add(SEND_MESSAGE_JOB, data, { ...SEND_MESSAGE_JOB_OPTIONS, jobId: messageId });
    await this.hub.publish(db.tenantId, { type: "message.created", conversationId, messageId });
    return quote;
  }

  /**
   * Issues a fresh public acceptance link for a `sent` quote so it can be copied. Only the hash is stored,
   * so the previously sent link stops working. No state change.
   */
  @Post(":id/accept-link")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async acceptLink(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<QuoteAcceptLink> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      const q = await lockQuote(tx, id);
      if (q.status !== "sent") throw new ConflictError(`Only sent quotes have an acceptance link (this one is ${q.status})`);
      if (q.validUntil.getTime() <= Date.now()) throw new ConflictError("The quote has expired");
      const { token, hash } = newAcceptToken(db.tenantId);
      await tx.update(quotes).set({ acceptTokenHash: hash, updatedAt: new Date() }).where(eq(quotes.id, id));
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "quote", entityId: id, action: "quote.accept_link_reissued", diff: {}, ip: req.ip });
      return { url: `${webBase()}/q/${token}`, validUntil: q.validUntil.toISOString() };
    });
  }

  /** accepted -> a `draft` order (idempotent: a live order of the quote is returned instead of a duplicate). */
  @Post(":id/convert-to-order")
  @Roles("owner", "admin", "agent")
  @HttpCode(201)
  async convert(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Order> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(convertBodySchema, body ?? {});
    return db.run(async (tx) => {
      const q = await lockQuote(tx, id);
      if (q.status !== "accepted") throw new ConflictError(`Only accepted quotes can be converted (this one is ${q.status})`);
      const [existing] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.quoteId, id), sql`${orders.status} <> 'cancelled'`))
        .limit(1);
      if (existing) return loadOrder(tx, existing.id);

      const items = await tx.select().from(quoteItems).where(eq(quoteItems.quoteId, id)).orderBy(quoteItems.position);
      const lines: OrderLine[] = [];
      for (const it of items) {
        const qty = Number(it.quantityMilli);
        if (qty % 1000 !== 0) throw new ValidationError(`Line '${it.description}' has a fractional quantity; orders need whole units`);
        let variantId: string | null = null;
        let options: Record<string, string> = {};
        if (it.variantId) {
          // 0016+: the exact variant the quote was priced with.
          const [v] = await tx.select().from(productVariants).where(eq(productVariants.id, it.variantId));
          if (!v || (it.productId !== null && v.productId !== it.productId)) {
            throw new ValidationError(`The variant of line '${it.description}' no longer exists`);
          }
          variantId = v.id;
          options = v.options;
        } else if (it.productId) {
          // Fallback for quotes created before 0016 (no variant_id): a single active variant, or the exact generated label.
          const [p] = await tx.select({ name: products.name }).from(products).where(eq(products.id, it.productId));
          const vs = await tx.select().from(productVariants).where(and(eq(productVariants.productId, it.productId), eq(productVariants.isActive, true)));
          const match = vs.length === 1 ? vs[0] : vs.find((v) => p && variantLabel(p.name, v.options) === it.description);
          if (!match) throw new ValidationError(`Cannot tell which variant line '${it.description}' refers to`);
          variantId = match.id;
          options = match.options;
        }
        const line = buildLine({
          productId: it.productId,
          productVersion: it.productVersion,
          description: it.description,
          quantityMilli: it.quantityMilli,
          unit: it.unit ?? "ud",
          unitPriceMinor: it.unitPriceMinor,
          discountBp: it.discountBp,
          taxRateBp: it.taxRateBp,
        });
        lines.push({ ...line, variantId, options, quantity: qty / 1000 });
      }
      const orderId = await insertOrderDraft(tx, {
        tenantId: db.tenantId,
        createdByType: "user",
        contactId: q.contactId,
        conversationId: q.conversationId,
        opportunityId: q.opportunityId,
        quoteId: id,
        currency: q.currency,
        lines,
        fulfillment: input.fulfillment,
        shippingAddress: input.shippingAddress ?? null,
        shippingMinor: input.shippingMinor ?? 0,
      });
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "quote", entityId: id, action: "quote.converted_to_order", diff: { orderId }, ip: req.ip });
      return loadOrder(tx, orderId);
    });
  }
}
