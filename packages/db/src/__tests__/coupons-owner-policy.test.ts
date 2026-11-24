import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const hasDb = Boolean(MIGRATOR_URL);

/**
 * Regression for the production 404 on POST /platform/coupons.
 * `coupons` has FORCE ROW LEVEL SECURITY, so the table owner (which runs the SECURITY DEFINER
 * platform_coupon_* functions) is subject to RLS too. Without an owner policy every INSERT fails
 * with 42501 (mapped to 404) and every SELECT silently returns zero rows. This is checked against
 * the catalog so it fails even when the local migrator role is a superuser that bypasses RLS.
 */
describe.skipIf(!hasDb)("coupons owner policy (0103)", () => {
  let migrator: DbHandle;

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
  });

  afterAll(async () => {
    await migrator?.close();
  });

  it("keeps FORCE RLS and grants the table owner an ALL policy", async () => {
    const rows = await migrator.db.execute<{ force: boolean; owner_policy: boolean }>(sql`
      select c.relforcerowsecurity as force,
             exists (
               select 1 from pg_policies p
               where p.schemaname = 'public' and p.tablename = 'coupons' and p.cmd = 'ALL'
                 and pg_get_userbyid(c.relowner) = any (p.roles)
                 and p.qual = 'true' and p.with_check = 'true'
             ) as owner_policy
      from pg_class c where c.oid = 'public.coupons'::regclass`);
    expect(rows[0]).toEqual({ force: true, owner_policy: true });
  });
});
