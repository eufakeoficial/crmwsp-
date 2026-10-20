import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { orderExtractionSchema } from "@crmwsp/contracts";
import {
  channelConnections,
  contacts,
  conversations,
  createDb,
  dangerouslyWithoutTenant,
  eq,
  inArray,
  messages,
  orderExtractions,
  productVariants,
  products,
  quoteItems,
  quotes,
  tenants,
  type DbHandle,
  type StoredOrderLine,
} from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TenantDb } from "../../db/tenant-db.js";
import { OrderExtractionsController, lineToDto } from "../../inbox/order-extractions.controller.js";

const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const APP_URL = process.env["DATABASE_URL"];
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const line = (over: Partial<StoredOrderLine>): StoredOrderLine => ({
  rawText: "",
  quantity: 6,
  unit: null,
  productGuess: "modelo B",
  status: "dudoso",
  reason: "ambiguous",
  confidence: 0.8,
  editedBy: null,
  match: null,
  quantityMilli: null,
  alternatives: [],
  ...over,
});

describe("lineToDto", () => {
  it("maps stored lines (string bigints) and drops unknown reasons", () => {
    const pid = randomUUID();
    const dto = lineToDto(
      line({
        status: "matched",
        reason: "weird",
        match: { productId: pid, variantId: null, productVersion: 1, label: "Modelo A", unit: "caja", unitPriceMinor: "2500", currency: "EUR", taxRateBp: 0 },
        quantityMilli: "12000",
      }),
      3,
    );
    expect(dto).toMatchObject({ index: 3, reason: null, quantityMilli: 12000, match: { unitPriceMinor: 2500 } });
  });
});

describe.skipIf(!hasDb)("order extractions controller (real Postgres, RLS)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const ctrl = new OrderExtractionsController();
  const req = { ip: "127.0.0.1" } as never;
  const ids = {} as { tenant: string; other: string; conv: string; ext: string; productA: string; productB: string; variantRojo: string };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 2 });
    const suffix = randomUUID().slice(0, 8);
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx.insert(tenants).values({ slug: `oe-api-${suffix}`, name: "OE" }).returning({ id: tenants.id });
      const [o] = await tx.insert(tenants).values({ slug: `oe-api-o-${suffix}`, name: "OE other" }).returning({ id: tenants.id });
      const [c] = await tx
        .insert(channelConnections)
        .values({ tenantId: t!.id, provider: "gupshup", phoneE164: "+34600000000", webhookToken: `oe-${randomUUID()}` })
        .returning({ id: channelConnections.id });
      const [ct] = await tx.insert(contacts).values({ tenantId: t!.id, phoneE164: "+34611111111" }).returning({ id: contacts.id });
      const [cv] = await tx.insert(conversations).values({ tenantId: t!.id, contactId: ct!.id, channelConnectionId: c!.id }).returning({ id: conversations.id });
      const [m] = await tx
        .insert(messages)
        .values({ tenantId: t!.id, conversationId: cv!.id, direction: "inbound", type: "audio", externalId: `wamid-${suffix}`, status: "received", author: "contact" })
        .returning({ id: messages.id });
      const [pa] = await tx.insert(products).values({ tenantId: t!.id, name: "Modelo A", unit: "caja", priceMinor: 2500n, currency: "EUR" }).returning({ id: products.id });
      const [pb] = await tx.insert(products).values({ tenantId: t!.id, name: "Modelo B", unit: "caja", priceMinor: 1000n, currency: "EUR" }).returning({ id: products.id });
      const [vr] = await tx
        .insert(productVariants)
        .values({ tenantId: t!.id, productId: pb!.id, options: { color: "Rojo" }, optionKey: "color=rojo", priceMinor: 1100n })
        .returning({ id: productVariants.id });
      const matchedA: StoredOrderLine = line({
        productGuess: "modelo A",
        quantity: 12,
        unit: "cajas",
        status: "matched",
        reason: null,
        confidence: 1,
        match: { productId: pa!.id, variantId: null, productVersion: 1, label: "Modelo A", unit: "caja", unitPriceMinor: "2500", currency: "EUR", taxRateBp: 0 },
        quantityMilli: "12000",
      });
      const [e] = await tx
        .insert(orderExtractions)
        .values({ tenantId: t!.id, conversationId: cv!.id, messageId: m!.id, source: "audio", status: "needs_confirmation", items: [matchedA, line({})], currency: "EUR" })
        .returning({ id: orderExtractions.id });
      Object.assign(ids, { tenant: t!.id, other: o!.id, conv: cv!.id, ext: e!.id, productA: pa!.id, productB: pb!.id, variantRojo: vr!.id });
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, [ids.tenant, ids.other].filter(Boolean))));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("an agent resolves the dudoso; the draft quote is priced from the catalog", async () => {
    const db = new TenantDb(app.db, ids.tenant, randomUUID());
    const list = await ctrl.list(db, { conversationId: ids.conv });
    expect(list.items).toHaveLength(1);
    expect(orderExtractionSchema.parse(list.items[0])).toBeTruthy();

    const out = await ctrl.updateLine(db, ids.ext, "1", { lockVersion: 0, productId: ids.productB, variantId: ids.variantRojo }, req);
    expect(out.status).toBe("ready");
    expect(out.lines[1]).toMatchObject({ status: "matched", editedByUser: true, match: { label: "Modelo B (Rojo)", unitPriceMinor: 1100 }, quantityMilli: 6000 });
    expect(out.quote).not.toBeNull();
    const [q] = await migrator.db.select().from(quotes).where(eq(quotes.id, out.quote!.id));
    expect(q).toMatchObject({ status: "draft", totalMinor: 12n * 2500n + 6n * 1100n });
    expect(await migrator.db.select().from(quoteItems).where(eq(quoteItems.quoteId, q!.id))).toHaveLength(2);

    await expect(ctrl.updateLine(db, ids.ext, "0", { lockVersion: 0, quantity: 3 }, req)).rejects.toMatchObject({ name: expect.stringMatching(/Conflict/) });
    const fixed = await ctrl.updateLine(db, ids.ext, "0", { lockVersion: 1, quantity: 3 }, req);
    expect(fixed.quote!.totalMinor).toBe(3 * 2500 + 6 * 1100);
  });

  it("another tenant cannot see or edit the extraction", async () => {
    const other = new TenantDb(app.db, ids.other, randomUUID());
    expect((await ctrl.list(other, {})).items).toHaveLength(0);
    await expect(ctrl.detail(other, ids.ext)).rejects.toMatchObject({ name: expect.stringMatching(/NotFound/) });
  });

  it("discarding cancels the draft quote", async () => {
    const db = new TenantDb(app.db, ids.tenant, randomUUID());
    const cur = await ctrl.detail(db, ids.ext);
    const out = await ctrl.discard(db, ids.ext, { lockVersion: cur.lockVersion }, req);
    expect(out.status).toBe("discarded");
    expect(out.quote?.status).toBe("cancelled");
  });
});
