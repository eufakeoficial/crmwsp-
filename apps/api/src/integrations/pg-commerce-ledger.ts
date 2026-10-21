import {
  and,
  auditEvents,
  commerceEvents,
  contacts,
  eq,
  externalSales,
  inArray,
  ne,
  or,
  orders,
  products,
  productVariants,
  sql,
  withTenant,
  type Database,
  type Transaction,
} from "@crmwsp/db";
import type { CatalogProduct, CommerceProvider, OrderSnapshot } from "@crmwsp/integrations";
import type { CommerceEventOutcome, CommerceLedger, CommerceLedgerTx, ExternalSaleUpsert } from "./commerce-ledger.js";

/** Drizzle implementation; every call runs under withTenant (RLS, ADR 0002). */
export class PgCommerceLedger implements CommerceLedger {
  constructor(private readonly db: Database) {}

  inTenant<T>(tenantId: string, fn: (tx: CommerceLedgerTx) => Promise<T>): Promise<T> {
    return withTenant(this.db, tenantId, (tx) => fn(new PgCommerceTx(tx, tenantId)));
  }
}

/** Stable option key for a synced variant ('' for a single default variant). */
export function optionKeyOf(options: Record<string, string>): string {
  return Object.keys(options)
    .sort()
    .map((k) => `${k.toLowerCase()}=${(options[k] ?? "").toLowerCase()}`)
    .join("|");
}

export class PgCommerceTx implements CommerceLedgerTx {
  constructor(
    private readonly tx: Transaction,
    private readonly tenantId: string,
  ) {}

  async recordEvent(e: { provider: CommerceProvider; eventId: string; eventType: string; payload: unknown }): Promise<string | null> {
    const rows = await this.tx
      .insert(commerceEvents)
      .values({
        tenantId: this.tenantId,
        provider: e.provider,
        eventId: e.eventId.slice(0, 255),
        eventType: e.eventType.slice(0, 120),
        outcome: "processing",
        payload: e.payload ?? null,
      })
      .onConflictDoNothing({ target: [commerceEvents.tenantId, commerceEvents.provider, commerceEvents.eventId] })
      .returning({ id: commerceEvents.id });
    return rows[0]?.id ?? null;
  }

  async setEventOutcome(id: string, outcome: CommerceEventOutcome, externalSaleId: string | null): Promise<void> {
    await this.tx.update(commerceEvents).set({ outcome: outcome.slice(0, 120), externalSaleId }).where(eq(commerceEvents.id, id));
  }

  async findContact(phoneE164: string | null, email: string | null): Promise<string | null> {
    const conds = [];
    if (phoneE164) conds.push(eq(contacts.phoneE164, phoneE164));
    if (email) conds.push(sql`lower(${contacts.extracted}->>'email') = ${email}`);
    if (conds.length === 0) return null;
    // Phone wins over email when both match different contacts.
    const rows = await this.tx
      .select({ id: contacts.id, phone: contacts.phoneE164 })
      .from(contacts)
      .where(or(...conds))
      .limit(5);
    return (rows.find((r) => phoneE164 !== null && r.phone === phoneE164) ?? rows[0])?.id ?? null;
  }

  async findOrder(orderId: string): Promise<OrderSnapshot | null> {
    const [o] = await this.tx
      .select({ id: orders.id, totalMinor: orders.totalMinor, currency: orders.currency })
      .from(orders)
      .where(eq(orders.id, orderId));
    return o ?? null;
  }

  async upsertExternalSale(s: ExternalSaleUpsert): Promise<string> {
    const now = new Date();
    const ex = sql.raw(`"external_sales"`);
    const [row] = await this.tx
      .insert(externalSales)
      .values({
        tenantId: this.tenantId,
        provider: s.provider,
        externalId: s.externalId.slice(0, 255),
        status: s.status,
        amountMinor: s.amountMinor === null ? null : BigInt(s.amountMinor),
        currency: s.currency,
        buyerEmail: s.buyerEmail,
        buyerPhoneE164: s.buyerPhoneE164,
        buyerName: s.buyerName,
        productRef: s.productRef,
        productName: s.productName,
        contactId: s.contactId,
        orderId: s.orderId,
        verification: s.verification,
        occurredAt: s.occurredAt,
        refundedAt: s.status === "refunded" ? now : null,
      })
      .onConflictDoUpdate({
        target: [externalSales.tenantId, externalSales.provider, externalSales.externalId],
        set: {
          // refunded is sticky; approved beats pending; a refund's amount never replaces the sale's.
          status: sql`CASE WHEN ${ex}."status" = 'refunded' OR excluded."status" = 'refunded' THEN 'refunded'
                           WHEN ${ex}."status" = 'approved' OR excluded."status" = 'approved' THEN 'approved'
                           ELSE 'pending' END`,
          amountMinor: sql`CASE WHEN excluded."status" = 'refunded' THEN COALESCE(${ex}."amount_minor", excluded."amount_minor")
                                ELSE COALESCE(excluded."amount_minor", ${ex}."amount_minor") END`,
          currency: sql`COALESCE(${ex}."currency", excluded."currency")`,
          buyerEmail: sql`COALESCE(${ex}."buyer_email", excluded."buyer_email")`,
          buyerPhoneE164: sql`COALESCE(${ex}."buyer_phone_e164", excluded."buyer_phone_e164")`,
          buyerName: sql`COALESCE(${ex}."buyer_name", excluded."buyer_name")`,
          productRef: sql`COALESCE(${ex}."product_ref", excluded."product_ref")`,
          productName: sql`COALESCE(${ex}."product_name", excluded."product_name")`,
          contactId: sql`COALESCE(${ex}."contact_id", excluded."contact_id")`,
          orderId: sql`COALESCE(${ex}."order_id", excluded."order_id")`,
          occurredAt: sql`COALESCE(${ex}."occurred_at", excluded."occurred_at")`,
          refundedAt: sql`COALESCE(${ex}."refunded_at", excluded."refunded_at")`,
          updatedAt: now,
        },
      })
      .returning({ id: externalSales.id, status: externalSales.status });
    if (!row) throw new Error("external sale upsert returned no row");
    await this.tx.insert(auditEvents).values({
      tenantId: this.tenantId,
      actorType: "system",
      actorId: null,
      entity: "external_sale",
      entityId: row.id,
      action: s.status === "refunded" ? "external_sale.refunded" : "external_sale.recorded",
      diff: {
        provider: s.provider,
        status: row.status,
        amountMinor: s.amountMinor === null ? null : String(s.amountMinor),
        currency: s.currency,
        contactId: s.contactId,
        orderId: s.orderId,
        verification: s.verification,
        eventId: s.eventId,
      },
      reason: `venta externa (${s.provider})`,
    });
    return row.id;
  }

  async upsertCatalog(source: CommerceProvider, currency: string, list: CatalogProduct[]): Promise<{ products: number; variants: number }> {
    let variantCount = 0;
    const now = new Date();
    for (const p of list) {
      const [prod] = await this.tx
        .insert(products)
        .values({
          tenantId: this.tenantId,
          externalSource: source,
          externalId: p.externalId,
          name: p.name.slice(0, 300),
          description: p.description,
          priceMinor: BigInt(p.priceMinor),
          currency,
          isActive: p.active,
          // Inventory stays in the external store; CRMWSP does not reserve stock for it.
          trackStock: false,
        })
        .onConflictDoUpdate({
          target: [products.tenantId, products.externalSource, products.externalId],
          targetWhere: sql`${products.externalSource} IS NOT NULL`,
          set: { name: p.name.slice(0, 300), description: p.description, priceMinor: BigInt(p.priceMinor), currency, isActive: p.active, updatedAt: now },
        })
        .returning({ id: products.id });
      if (!prod) throw new Error("product upsert returned no row");

      // SKUs are unique per tenant among active variants: never steal one from a manual variant.
      const skus = p.variants.map((v) => v.sku).filter((s): s is string => !!s);
      const taken = new Set(
        skus.length === 0
          ? []
          : (
              await this.tx
                .select({ sku: productVariants.sku })
                .from(productVariants)
                .where(
                  and(
                    inArray(productVariants.sku, skus),
                    eq(productVariants.isActive, true),
                    ne(productVariants.productId, prod.id),
                  ),
                )
            ).map((r) => r.sku),
      );
      for (const [i, v] of p.variants.entries()) {
        const sku = v.sku && !taken.has(v.sku) ? v.sku : null;
        const values = {
          sku,
          options: v.options,
          optionKey: optionKeyOf(v.options) || (p.variants.length > 1 ? `ext:${v.externalId}` : ""),
          priceMinor: v.priceMinor === null ? null : BigInt(v.priceMinor),
          compareAtMinor: v.compareAtMinor === null ? null : BigInt(v.compareAtMinor),
          isActive: p.active,
          position: i,
        };
        await this.tx
          .insert(productVariants)
          .values({ tenantId: this.tenantId, productId: prod.id, externalSource: source, externalId: v.externalId, ...values })
          .onConflictDoUpdate({
            target: [productVariants.tenantId, productVariants.externalSource, productVariants.externalId],
            targetWhere: sql`${productVariants.externalSource} IS NOT NULL`,
            set: { ...values, updatedAt: now },
          });
        variantCount += 1;
      }
    }
    return { products: list.length, variants: variantCount };
  }
}
