import { decideExternalSale, type CatalogProduct, type CommerceProvider, type NormalizedCommerceEvent, type OrderSnapshot } from "@crmwsp/integrations";

/*
 * Applies a verified commerce event in ONE tenant transaction (same shape as payment-ledger):
 *   1. dedupe row (tenant, provider, event id) ON CONFLICT DO NOTHING -> replay = no-op;
 *   2. product events upsert the synced catalog; sale events upsert `external_sales`, matched to
 *      a contact by phone / email, linked to a CRMWSP order ONLY through decideExternalSale;
 *   3. outcome recorded on the dedupe row. A throw rolls everything back (provider retries).
 * No CRMWSP order is ever transitioned here.
 */

export type CommerceEventOutcome = "duplicate" | "ignored" | "catalog_updated" | "catalog_skipped" | `recorded:${string}`;

export interface ExternalSaleUpsert {
  provider: CommerceProvider;
  externalId: string;
  status: "pending" | "approved" | "refunded";
  amountMinor: number | null;
  currency: string | null;
  buyerEmail: string | null;
  buyerPhoneE164: string | null;
  buyerName: string | null;
  productRef: string | null;
  productName: string | null;
  contactId: string | null;
  orderId: string | null;
  verification: "hmac_body" | "shared_token";
  occurredAt: Date | null;
  eventId: string;
}

export interface CommerceLedgerTx {
  recordEvent(e: { provider: CommerceProvider; eventId: string; eventType: string; payload: unknown }): Promise<string | null>;
  setEventOutcome(id: string, outcome: CommerceEventOutcome, externalSaleId: string | null): Promise<void>;
  findContact(phoneE164: string | null, email: string | null): Promise<string | null>;
  findOrder(orderId: string): Promise<OrderSnapshot | null>;
  /** Insert or merge by (provider, external id); returns the row id. A refund is sticky. */
  upsertExternalSale(s: ExternalSaleUpsert): Promise<string>;
  upsertCatalog(source: CommerceProvider, currency: string, products: CatalogProduct[]): Promise<{ products: number; variants: number }>;
}

export interface CommerceLedger {
  inTenant<T>(tenantId: string, fn: (tx: CommerceLedgerTx) => Promise<T>): Promise<T>;
}

/** Best-effort E.164: keeps digits, requires 8..15 of them. Providers send many formats. */
export function phoneToE164(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, "");
  if (digits.length < 8 || digits.length > 15 || digits.startsWith("0")) return null;
  return `+${digits}`;
}

export function normalizeEmail(email: string | null): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254 ? e : null;
}

export async function applyCommerceEvent(
  ledger: CommerceLedger,
  tenantId: string,
  ev: NormalizedCommerceEvent,
  payload: unknown,
  ctx: { shopCurrency: string | null },
): Promise<{ outcome: CommerceEventOutcome; externalSaleId: string | null }> {
  return ledger.inTenant(tenantId, async (tx) => {
    const rowId = await tx.recordEvent({ provider: ev.provider, eventId: ev.eventId, eventType: ev.providerEventType, payload });
    if (rowId === null) return { outcome: "duplicate", externalSaleId: null };
    const done = async (outcome: CommerceEventOutcome, externalSaleId: string | null = null) => {
      await tx.setEventOutcome(rowId, outcome, externalSaleId);
      return { outcome, externalSaleId };
    };

    if (ev.type === "product_updated") {
      if (!ev.product || !ctx.shopCurrency) return done("catalog_skipped");
      await tx.upsertCatalog(ev.provider, ctx.shopCurrency, [ev.product]);
      return done("catalog_updated");
    }
    const sale = ev.sale;
    if (ev.type === "ignored" || !sale || !sale.externalId) return done("ignored");

    const email = normalizeEmail(sale.buyer.email);
    const phone = phoneToE164(sale.buyer.phone);
    const contactId = await tx.findContact(phone, email);
    const order = sale.crmwspOrderId ? await tx.findOrder(sale.crmwspOrderId) : null;
    const decision = decideExternalSale(ev, order);
    const id = await tx.upsertExternalSale({
      provider: ev.provider,
      externalId: sale.externalId,
      status: sale.status,
      amountMinor: sale.amountMinor,
      currency: sale.currency,
      buyerEmail: email,
      buyerPhoneE164: phone,
      buyerName: sale.buyer.name,
      productRef: sale.productRef,
      productName: sale.productName,
      contactId,
      orderId: decision.link ? decision.orderId : null,
      verification: ev.verification,
      occurredAt: sale.occurredAt,
      eventId: ev.eventId,
    });
    return done(`recorded:${decision.link ? "order_linked" : decision.reason}`, id);
  });
}
