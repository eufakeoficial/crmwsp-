import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { salesPlaybooks, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("sales_playbooks RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: { tenant: string; playbook: string };
  let B: { tenant: string; playbook: string };

  async function seed(label: string): Promise<{ tenant: string; playbook: string }> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `playbook-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      const [p] = await tx
        .insert(salesPlaybooks)
        .values({ tenantId: t.id, enabled: true, config: { closingStyle: "soft" } })
        .returning({ id: salesPlaybooks.id });
      if (!p) throw new Error("seed failed");
      return { tenant: t.id, playbook: p.id };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    A = await seed("a");
    B = await seed("b");
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("tenant A only sees its own playbook, and nothing without a tenant", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: salesPlaybooks.id }).from(salesPlaybooks));
    expect(rows.map((r) => r.id)).toEqual([A.playbook]);
    expect(await app.db.select({ id: salesPlaybooks.id }).from(salesPlaybooks)).toHaveLength(0);
  });

  it("tenant A cannot update, delete nor insert B's playbook", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(salesPlaybooks).set({ enabled: false }).where(eq(salesPlaybooks.id, B.playbook)).returning({ id: salesPlaybooks.id }),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(app.db, A.tenant, (tx) =>
      tx.delete(salesPlaybooks).where(eq(salesPlaybooks.id, B.playbook)).returning({ id: salesPlaybooks.id }),
    );
    expect(del).toHaveLength(0);
    const ins = await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(salesPlaybooks).values({ tenantId: B.tenant })));
    expect(ins).toBeInstanceOf(Error);
  });

  it("allows one playbook per tenant", async () => {
    const dup = await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(salesPlaybooks).values({ tenantId: A.tenant })));
    expect(dup).toBeInstanceOf(Error);
  });
});
