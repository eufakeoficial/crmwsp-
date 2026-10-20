import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { adAttributions, adSpend, capiEvents, channelConnections, contacts, conversations, metaCapiConnections, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const must = <T>(row: T | undefined): T => {
  if (row === undefined) throw new Error("seed failed");
  return row;
};
const settle = <T>(p: Promise<T>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);

interface Seed {
  tenant: string;
  contact: string;
  attribution: string;
  spend: string;
  capi: string;
  event: string;
}

describe.skipIf(!hasDb)("ad attribution, ad spend and Conversions API RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const tenant = must((await tx.insert(tenants).values({ slug: `ads-${label}-${suffix}`, name: label }).returning({ id: tenants.id }))[0]).id;
      const conn = must(
        (await tx
          .insert(channelConnections)
          .values({ tenantId: tenant, provider: "gupshup", phoneE164: "+34600000001", webhookToken: `tok-ads-${label}-${randomUUID()}`, status: "active" })
          .returning({ id: channelConnections.id }))[0],
      ).id;
      const contact = must((await tx.insert(contacts).values({ tenantId: tenant, phoneE164: "+34611111111" }).returning({ id: contacts.id }))[0]).id;
      const conversation = must(
        (await tx.insert(conversations).values({ tenantId: tenant, contactId: contact, channelConnectionId: conn }).returning({ id: conversations.id }))[0],
      ).id;
      const attribution = must(
        (await tx
          .insert(adAttributions)
          .values({ tenantId: tenant, contactId: contact, conversationId: conversation, sourceId: `ad-${label}`, ctwaClid: "clid", firstSeenAt: new Date() })
          .returning({ id: adAttributions.id }))[0],
      ).id;
      const spend = must(
        (await tx.insert(adSpend).values({ tenantId: tenant, sourceId: `ad-${label}`, currency: "EUR", amountMinor: 1000n }).returning({ id: adSpend.id }))[0],
      ).id;
      const capi = must(
        (await tx
          .insert(metaCapiConnections)
          .values({ tenantId: tenant, datasetId: "123456789", accessTokenEncrypted: Buffer.from("ciphertext") })
          .returning({ id: metaCapiConnections.id }))[0],
      ).id;
      const event = must(
        (await tx
          .insert(capiEvents)
          .values({ tenantId: tenant, eventId: `lead:${attribution}`, eventName: "Lead", contactId: contact, eventTime: new Date() })
          .returning({ id: capiEvents.id }))[0],
      ).id;
      return { tenant, contact, attribution, spend, capi, event };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 2 });
    app = createDb(APP_URL as string, { max: 4 });
    A = await seed("a");
    B = await seed("b");
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      await migrator.close();
    }
    await app?.close();
  });

  it("each tenant sees only its own rows", async () => {
    await withTenant(app.db, A.tenant, async (tx) => {
      expect((await tx.select({ id: adAttributions.id }).from(adAttributions)).map((r) => r.id)).toEqual([A.attribution]);
      expect((await tx.select({ id: adSpend.id }).from(adSpend)).map((r) => r.id)).toEqual([A.spend]);
      expect((await tx.select({ id: metaCapiConnections.id }).from(metaCapiConnections)).map((r) => r.id)).toEqual([A.capi]);
      expect((await tx.select({ id: capiEvents.id }).from(capiEvents)).map((r) => r.id)).toEqual([A.event]);
    });
  });

  it("without tenant context nothing is visible", async () => {
    const rows = await app.db.transaction((tx) => tx.select({ id: adAttributions.id }).from(adAttributions));
    expect(rows).toEqual([]);
  });

  it("cannot write rows for another tenant nor touch them", async () => {
    await withTenant(app.db, A.tenant, async (tx) => {
      const upd = await tx.update(adSpend).set({ amountMinor: 1n }).where(eq(adSpend.id, B.spend)).returning({ id: adSpend.id });
      expect(upd).toEqual([]);
    });
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) => tx.insert(adSpend).values({ tenantId: B.tenant, sourceId: "x", currency: "EUR", amountMinor: 1n })),
    );
    expect(err).toBeInstanceOf(Error);
  });

  it("the sent-events log and attributions cannot be deleted by the app role", async () => {
    expect(await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(capiEvents).where(eq(capiEvents.id, A.event))))).toBeInstanceOf(Error);
    expect(await settle(withTenant(app.db, A.tenant, (tx) => tx.delete(adAttributions).where(eq(adAttributions.id, A.attribution))))).toBeInstanceOf(
      Error,
    );
  });

  it("event ids are unique per tenant; first-touch is unique per contact", async () => {
    const dup = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(capiEvents).values({ tenantId: A.tenant, eventId: `lead:${A.attribution}`, eventName: "Lead", contactId: A.contact, eventTime: new Date() }),
      ),
    );
    expect(dup).toBeInstanceOf(Error);
    const again = await withTenant(app.db, A.tenant, (tx) =>
      tx
        .insert(adAttributions)
        .values({ tenantId: A.tenant, contactId: A.contact, sourceId: "other", firstSeenAt: new Date() })
        .onConflictDoNothing()
        .returning({ id: adAttributions.id }),
    );
    expect(again).toEqual([]);
  });

  it("capi_tenant_ids lists only tenants with an active connection", async () => {
    await withTenant(app.db, B.tenant, (tx) => tx.update(metaCapiConnections).set({ status: "disabled" }));
    const rows = await app.db.execute<{ tenant_id: string }>(sql`select tenant_id from capi_tenant_ids()`);
    const ids = rows.map((r) => r.tenant_id);
    expect(ids).toContain(A.tenant);
    expect(ids).not.toContain(B.tenant);
  });
});
