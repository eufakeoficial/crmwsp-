import { randomUUID } from "node:crypto";
import type { ContactFilter, FilterCondition } from "@crmwsp/contracts";
import {
  adAttributions,
  channelConnections,
  consents,
  contacts,
  conversations,
  createDb,
  dangerouslyWithoutTenant,
  inArray,
  orders,
  quotes,
  tenants,
  withTenant,
  type DbHandle,
} from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { contactFilterWhere } from "./contact-query.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

/** Runs every compiled field against Postgres (RLS app role) on an already-migrated database. */
describe.skipIf(!hasDb)("contact filter compiler against Postgres", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const ids = { a: "", b: "", ana: "", luis: "", other: "" };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a] = await tx.insert(tenants).values({ slug: `flt-a-${suffix}`, name: "A" }).returning({ id: tenants.id });
      const [b] = await tx.insert(tenants).values({ slug: `flt-b-${suffix}`, name: "B" }).returning({ id: tenants.id });
      ids.a = a!.id;
      ids.b = b!.id;
      const [ana] = await tx
        .insert(contacts)
        .values({ tenantId: ids.a, phoneE164: "+34600000001", name: "Ana 50%", tags: ["vip"], extracted: { city: "Lima" } })
        .returning({ id: contacts.id });
      const [luis] = await tx
        .insert(contacts)
        .values({ tenantId: ids.a, phoneE164: "+34600000002", name: "Luis", source: "import" })
        .returning({ id: contacts.id });
      const [other] = await tx.insert(contacts).values({ tenantId: ids.b, phoneE164: "+34600000001", name: "Ana", tags: ["vip"] }).returning({ id: contacts.id });
      ids.ana = ana!.id;
      ids.luis = luis!.id;
      ids.other = other!.id;
      const [conn] = await tx
        .insert(channelConnections)
        .values({ tenantId: ids.a, provider: "gupshup", phoneE164: "+34611111111", webhookToken: `flt-${randomUUID()}` })
        .returning({ id: channelConnections.id });
      await tx.insert(conversations).values({ tenantId: ids.a, contactId: ids.ana, channelConnectionId: conn!.id, lastInboundAt: new Date(), lastMessageAt: new Date() });
      await tx.insert(consents).values({ tenantId: ids.a, contactId: ids.ana, kind: "marketing", status: "granted", evidence: { source: "test" } });
      await tx.insert(orders).values({ tenantId: ids.a, number: `O-${suffix}`, contactId: ids.ana, status: "paid", currency: "EUR", totalMinor: 5000n, fulfillment: "digital", createdByType: "user" });
      await tx.insert(quotes).values({ tenantId: ids.a, number: `Q-${suffix}`, contactId: ids.luis, status: "sent", currency: "EUR", validUntil: new Date(), createdByType: "user" });
      await tx.insert(adAttributions).values({ tenantId: ids.a, contactId: ids.ana, sourceId: "ad-123", firstSeenAt: new Date() });
    });
  });

  afterAll(async () => {
    if (migrator) {
      const t = [ids.a, ids.b].filter(Boolean);
      if (t.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, t)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  const match = async (filter: ContactFilter, q?: string): Promise<string[]> =>
    withTenant(app.db, ids.a, async (tx) => {
      const rows = await tx.select({ id: contacts.id }).from(contacts).where(await contactFilterWhere(tx, filter, q));
      return rows.map((r) => r.id).sort();
    });
  const one = (c: FilterCondition) => match({ match: "all", conditions: [c] });

  it("evaluates each field family and never leaks the other tenant", async () => {
    expect(await one({ field: "tag", type: "relation", operator: "is", value: ["vip"] })).toEqual([ids.ana]);
    expect(await one({ field: "marketing_consent", type: "relation", operator: "is", value: ["none"] })).toEqual([ids.luis]);
    expect(await one({ field: "source", type: "relation", operator: "is", value: ["ad"] })).toEqual([ids.ana]);
    expect(await one({ field: "source", type: "relation", operator: "is", value: ["import"] })).toEqual([ids.luis]);
    expect(await one({ field: "name", type: "text", operator: "contains", value: "50%" })).toEqual([ids.ana]);
    expect(await one({ field: "name", type: "text", operator: "contains", value: "_" })).toEqual([]);
    expect(await one({ field: "name", type: "text", operator: "is", value: "'; drop table contacts; --" })).toEqual([]);
    expect(await one({ field: "cf:city", type: "text", operator: "is", value: "lima" })).toEqual([ids.ana]);
    expect(await one({ field: "ad_id", type: "text", operator: "is", value: "ad-123" })).toEqual([ids.ana]);
    expect(await one({ field: "last_inbound_at", type: "date", operator: "less_than_ago", value: { amount: 1, unit: "hours" } })).toEqual([ids.ana]);
    expect(await one({ field: "last_message_at", type: "date", operator: "is_unknown" })).toEqual([ids.luis]);
    expect(await one({ field: "created_at", type: "date", operator: "after", value: "2000-01-01" })).toHaveLength(2);
    expect(await one({ field: "last_order_at", type: "date", operator: "has_any" })).toEqual([ids.ana]);
    expect(await one({ field: "window_open", type: "relation", operator: "is", value: ["closed"] })).toEqual([ids.luis]);
    expect(await one({ field: "has_open_quote", type: "relation", operator: "is", value: ["yes"] })).toEqual([ids.luis]);
    expect(await one({ field: "has_paid_order", type: "relation", operator: "is_not", value: ["yes"] })).toEqual([ids.luis]);
    expect(await one({ field: "total_paid", type: "number", operator: "gt", value: 4999 })).toEqual([ids.ana]);
    expect(await one({ field: "total_paid", type: "number", operator: "is_unknown" })).toEqual([ids.luis]);
  });

  it("combines with all / any and the free-text search", async () => {
    const a: FilterCondition = { field: "tag", type: "relation", operator: "is", value: ["vip"] };
    const b: FilterCondition = { field: "source", type: "relation", operator: "is", value: ["import"] };
    expect(await match({ match: "all", conditions: [a, b] })).toEqual([]);
    expect(await match({ match: "any", conditions: [a, b] })).toEqual([ids.ana, ids.luis].sort());
    expect(await match({ match: "any", conditions: [a, b] }, "Luis")).toEqual([ids.luis]);
  });
});
