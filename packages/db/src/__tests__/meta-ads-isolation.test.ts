import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { adSpendDaily, metaAdsConnections, tenants } from "../schema/index.js";
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
  connection: string;
  daily: string;
}

describe.skipIf(!hasDb)("Meta Ads connections and daily spend RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const tenant = must((await tx.insert(tenants).values({ slug: `mads-${label}-${suffix}`, name: label }).returning({ id: tenants.id }))[0]).id;
      const connection = must(
        (await tx
          .insert(metaAdsConnections)
          .values({ tenantId: tenant, adAccountId: "act_123456", currency: "EUR", accessTokenEncrypted: Buffer.from("ciphertext") })
          .returning({ id: metaAdsConnections.id }))[0],
      ).id;
      const daily = must(
        (await tx
          .insert(adSpendDaily)
          .values({ tenantId: tenant, adId: `ad-${label}`, date: "2026-10-01", spendMinor: 1000, currency: "EUR", adAccountId: "act_123456" })
          .returning({ id: adSpendDaily.id }))[0],
      ).id;
      return { tenant, connection, daily };
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
      expect((await tx.select({ id: metaAdsConnections.id }).from(metaAdsConnections)).map((r) => r.id)).toEqual([A.connection]);
      expect((await tx.select({ id: adSpendDaily.id }).from(adSpendDaily)).map((r) => r.id)).toEqual([A.daily]);
    });
  });

  it("without tenant context nothing is visible", async () => {
    const rows = await app.db.transaction(async (tx) => [
      ...(await tx.select({ id: metaAdsConnections.id }).from(metaAdsConnections)),
      ...(await tx.select({ id: adSpendDaily.id }).from(adSpendDaily)),
    ]);
    expect(rows).toEqual([]);
  });

  it("cannot write rows for another tenant nor touch them", async () => {
    await withTenant(app.db, A.tenant, async (tx) => {
      expect(await tx.update(adSpendDaily).set({ spendMinor: 1 }).where(eq(adSpendDaily.id, B.daily)).returning({ id: adSpendDaily.id })).toEqual([]);
      expect(await tx.delete(metaAdsConnections).where(eq(metaAdsConnections.id, B.connection)).returning({ id: metaAdsConnections.id })).toEqual([]);
    });
    const err = await settle(
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(adSpendDaily).values({ tenantId: B.tenant, adId: "x", date: "2026-10-02", spendMinor: 1, currency: "EUR", adAccountId: "act_1" }),
      ),
    );
    expect(err).toBeInstanceOf(Error);
  });

  it("the sync tick lists active tenants by id only", async () => {
    const ids = (await app.db.execute<{ tenant_id: string }>(sql`select tenant_id from meta_ads_tenant_ids()`)).map((r) => r.tenant_id);
    expect(ids).toEqual(expect.arrayContaining([A.tenant, B.tenant]));
    await dangerouslyWithoutTenant(migrator.db, (tx) => tx.update(metaAdsConnections).set({ status: "disabled" }).where(eq(metaAdsConnections.id, B.connection)));
    const after = (await app.db.execute<{ tenant_id: string }>(sql`select tenant_id from meta_ads_tenant_ids()`)).map((r) => r.tenant_id);
    expect(after).toContain(A.tenant);
    expect(after).not.toContain(B.tenant);
  });
});
