import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { aiScenarios, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

describe.skipIf(!hasDb)("ai_scenarios RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: { tenant: string; scenario: string };
  let B: { tenant: string; scenario: string };

  async function seed(label: string): Promise<{ tenant: string; scenario: string }> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [t] = await tx
        .insert(tenants)
        .values({ slug: `scn-${label}-${suffix}`, name: `Tenant ${label}` })
        .returning({ id: tenants.id });
      if (!t) throw new Error("seed failed");
      const [s] = await tx
        .insert(aiScenarios)
        .values({ tenantId: t.id, name: `Scenario ${label}`, messages: ["Hola"], expectations: ["must_handoff"] })
        .returning({ id: aiScenarios.id });
      if (!s) throw new Error("seed failed");
      return { tenant: t.id, scenario: s.id };
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

  it("tenant A only sees its own scenarios; no tenant sees nothing", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: aiScenarios.id }).from(aiScenarios));
    expect(rows.map((r) => r.id)).toEqual([A.scenario]);
    expect(await app.db.select({ id: aiScenarios.id }).from(aiScenarios)).toHaveLength(0);
  });

  it("tenant A cannot update, delete nor insert B's scenarios", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(aiScenarios).set({ name: "x" }).where(eq(aiScenarios.id, B.scenario)).returning({ id: aiScenarios.id }),
    );
    expect(upd).toHaveLength(0);
    const del = await withTenant(app.db, A.tenant, (tx) =>
      tx.delete(aiScenarios).where(eq(aiScenarios.id, B.scenario)).returning({ id: aiScenarios.id }),
    );
    expect(del).toHaveLength(0);
    const ins = await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(aiScenarios).values({ tenantId: B.tenant, name: "x" })));
    expect(ins).toBeInstanceOf(Error);
    const [still] = await dangerouslyWithoutTenant(migrator.db, (tx) =>
      tx.select({ name: aiScenarios.name }).from(aiScenarios).where(eq(aiScenarios.id, B.scenario)),
    );
    expect(still?.name).toBe("Scenario b");
  });
});
