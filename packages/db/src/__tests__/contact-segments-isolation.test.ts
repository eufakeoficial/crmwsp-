import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { contactSegments, contacts, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const pgCode = (err: unknown): string | undefined =>
  ((err as Error & { cause?: { code?: string } } | undefined)?.cause ?? (err as { code?: string } | undefined))?.code;
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

const FILTER = { match: "all" as const, conditions: [] };

describe.skipIf(!hasDb)("contact_segments isolation (RLS) with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const A = { tenant: "", segment: "" };
  const B = { tenant: "", segment: "" };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      for (const [s, label] of [
        [A, "a"],
        [B, "b"],
      ] as const) {
        const [t] = await tx.insert(tenants).values({ slug: `seg-${label}-${suffix}`, name: `SEG ${label}` }).returning({ id: tenants.id });
        if (!t) throw new Error("seed failed");
        s.tenant = t.id;
        const [seg] = await tx
          .insert(contactSegments)
          .values({ tenantId: t.id, name: "VIP", filter: FILTER })
          .returning({ id: contactSegments.id });
        s.segment = seg!.id;
      }
    });
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A.tenant, B.tenant].filter(Boolean);
      if (ids.length) await dangerouslyWithoutTenant(migrator.db, (tx) => tx.delete(tenants).where(inArray(tenants.id, ids)));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("selects only the current tenant's segments", async () => {
    const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: contactSegments.id }).from(contactSegments));
    expect(rows).toEqual([{ id: A.segment }]);
  });

  it("cannot update or delete another tenant's segment (0 rows)", async () => {
    const upd = await withTenant(app.db, A.tenant, (tx) =>
      tx.update(contactSegments).set({ name: "x" }).where(eq(contactSegments.id, B.segment)).returning({ id: contactSegments.id }),
    );
    expect(upd).toEqual([]);
    const del = await withTenant(app.db, A.tenant, (tx) =>
      tx.delete(contactSegments).where(eq(contactSegments.id, B.segment)).returning({ id: contactSegments.id }),
    );
    expect(del).toEqual([]);
  });

  it("cannot insert segments for another tenant (WITH CHECK)", async () => {
    const err = await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(contactSegments).values({ tenantId: B.tenant, name: "x", filter: FILTER })));
    expect(pgCode(err)).toBe("42501");
  });

  it("segment names are unique per tenant and contacts default to organic source", async () => {
    const dup = await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(contactSegments).values({ tenantId: A.tenant, name: "VIP", filter: FILTER })));
    expect(pgCode(dup)).toBe("23505");
    const [c] = await withTenant(app.db, A.tenant, (tx) =>
      tx.insert(contacts).values({ tenantId: A.tenant, phoneE164: "+34699999999" }).returning({ source: contacts.source }),
    );
    expect(c?.source).toBe("organic");
  });
});
