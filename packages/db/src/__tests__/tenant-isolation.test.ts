import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client";
import { runMigrations } from "../migrate";
import { memberships, tenants, users } from "../schema/index";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

if (!hasDb) {
  console.warn(
    "[tenant-isolation] skipped: set DATABASE_URL_MIGRATOR (DDL role) and DATABASE_URL (app role, NOBYPASSRLS), e.g. " +
      "DATABASE_URL_MIGRATOR=postgresql://crmwsp:crmwsp@localhost:5432/crmwsp " +
      "DATABASE_URL=postgresql://crmwsp_app:crmwsp_app@localhost:5432/crmwsp",
  );
}

describe.skipIf(!hasDb)("tenant isolation (RLS) with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let tenantA = "";
  let tenantB = "";
  let userId = "";
  let membershipB = "";

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    // max: 1 forces connection reuse, so a leaked tenant setting would show up.
    app = createDb(APP_URL as string, { max: 1 });

    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `test-a-${suffix}`, name: "Tenant A" },
          { slug: `test-b-${suffix}`, name: "Tenant B" },
        ])
        .returning({ id: tenants.id });
      const [u] = await tx
        .insert(users)
        .values({ email: `iso-${suffix}@example.test`, name: "Iso" })
        .returning({ id: users.id });
      if (!a || !b || !u) throw new Error("seed failed");
      tenantA = a.id;
      tenantB = b.id;
      userId = u.id;
      const [, mB] = await tx
        .insert(memberships)
        .values([
          { tenantId: tenantA, userId, role: "owner" },
          { tenantId: tenantB, userId, role: "agent" },
        ])
        .returning({ id: memberships.id });
      if (!mB) throw new Error("seed failed");
      membershipB = mB.id;
    });
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        const ids = [tenantA, tenantB].filter(Boolean);
        if (ids.length) await tx.delete(tenants).where(inArray(tenants.id, ids));
        if (userId) await tx.delete(users).where(eq(users.id, userId));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("app role is not superuser and cannot bypass RLS", async () => {
    const rows = await app.sql<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user`;
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });

  it("select on tenants and memberships only returns rows of the current tenant", async () => {
    const result = await withTenant(app.db, tenantA, async (tx) => ({
      tenants: await tx.select({ id: tenants.id }).from(tenants),
      memberships: await tx.select({ tenantId: memberships.tenantId }).from(memberships),
    }));
    expect(result.tenants).toEqual([{ id: tenantA }]);
    expect(result.memberships.length).toBeGreaterThan(0);
    expect(result.memberships.every((m) => m.tenantId === tenantA)).toBe(true);
  });

  it("insert into memberships with another tenant_id fails (WITH CHECK)", async () => {
    const otherUser = await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({ email: `iso2-${suffix}@example.test` })
        .returning({ id: users.id });
      if (!u) throw new Error("seed failed");
      return u.id;
    });
    try {
      const error = await withTenant(app.db, tenantA, (tx) =>
        tx.insert(memberships).values({ tenantId: tenantB, userId: otherUser, role: "viewer" }),
      ).then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      // Drizzle wraps the driver error; the Postgres error is in `cause`.
      const cause = (error as Error & { cause?: { code?: string; message?: string } }).cause;
      expect(cause?.code).toBe("42501");
      expect(cause?.message).toMatch(/row-level security/i);
    } finally {
      await migrator.db.delete(users).where(eq(users.id, otherUser));
    }
  });

  it("update of another tenant's membership affects 0 rows", async () => {
    const updated = await withTenant(app.db, tenantA, (tx) =>
      tx
        .update(memberships)
        .set({ role: "owner" })
        .where(eq(memberships.id, membershipB))
        .returning({ id: memberships.id }),
    );
    expect(updated).toHaveLength(0);
    const [row] = await migrator.db
      .select({ role: memberships.role })
      .from(memberships)
      .where(eq(memberships.id, membershipB));
    expect(row?.role).toBe("agent");
  });

  it("without withTenant the app role sees 0 rows (and the setting does not leak)", async () => {
    // A previous withTenant ran on this same pooled connection.
    await withTenant(app.db, tenantA, (tx) => tx.select().from(tenants));
    const t = await app.db.select().from(tenants);
    const m = await app.db.select().from(memberships);
    expect(t).toHaveLength(0);
    expect(m).toHaveLength(0);
  });

  it("app role cannot create or delete tenants, even with a matching tenant setting", async () => {
    const newId = randomUUID();
    const insertError = await withTenant(app.db, newId, (tx) =>
      tx.insert(tenants).values({ id: newId, slug: `evil-${suffix}`, name: "Evil" }),
    ).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(insertError).toBeInstanceOf(Error);
    const cause = (insertError as Error & { cause?: { code?: string } }).cause;
    expect(cause?.code).toBe("42501");

    const deleted = await withTenant(app.db, tenantA, (tx) =>
      tx.delete(tenants).where(eq(tenants.id, tenantA)).returning({ id: tenants.id }),
    );
    expect(deleted).toHaveLength(0);
    const [row] = await migrator.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantA));
    expect(row?.id).toBe(tenantA);
  });

  it("withTenant rejects a non-uuid tenant id", async () => {
    await expect(
      withTenant(app.db, "' or 1=1 --", async () => undefined),
    ).rejects.toThrow(/uuid/);
  });
});
