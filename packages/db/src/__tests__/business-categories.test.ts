import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, tenants, users } from "../schema/index.js";
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

describe.skipIf(!hasDb)("business categories (0077)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const s = { admin: "", a: "", b: "" };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [u] = await tx.insert(users).values({ email: `cat-admin-${suffix}@example.test`, name: "Admin" }).returning({ id: users.id });
      s.admin = u!.id;
      const [a, b] = await tx
        .insert(tenants)
        .values([
          { slug: `cat-a-${suffix}`, name: "Cat A" },
          { slug: `cat-b-${suffix}`, name: "Cat B" },
        ])
        .returning({ id: tenants.id });
      s.a = a!.id;
      s.b = b!.id;
    });
    await migrator.sql`insert into platform_admins (user_id) values (${s.admin})`;
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        await tx.delete(tenants).where(inArray(tenants.id, [s.a, s.b].filter(Boolean)));
        if (s.admin) await tx.delete(users).where(eq(users.id, s.admin));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("exposes the seeded taxonomy to the app role, but not the table", async () => {
    const rows = await app.sql<{ key: string; action: string }[]>`select key, action from public.business_category_list()`;
    expect(rows.find((r) => r.key === "armas")?.action).toBe("block");
    expect(rows.find((r) => r.key === "salud_citas")?.action).toBe("review");
    expect(pgCode(await settle(app.sql`select * from public.business_categories`))).toBe("42501");
  });

  it("refuses a blocked category and another tenant's id", async () => {
    const blocked = await settle(withTenant(app.db, s.a, (tx) => tx.execute(sql`select public.tenant_set_business_category(${s.a}::uuid, 'armas', null)`)));
    expect(pgCode(blocked)).toBe("42501");
    const cross = await settle(withTenant(app.db, s.a, (tx) => tx.execute(sql`select public.tenant_set_business_category(${s.b}::uuid, 'comercio_minorista', null)`)));
    expect(pgCode(cross)).toBe("42501");
  });

  it("puts a review category in pending, blocks channels until an admin approves", async () => {
    await withTenant(app.db, s.a, (tx) => tx.execute(sql`select public.tenant_set_business_category(${s.a}::uuid, 'salud_citas', 'solo citas')`));
    const insertChannel = () =>
      withTenant(app.db, s.a, (tx) =>
        tx.insert(channelConnections).values({ tenantId: s.a, provider: "gupshup", phoneE164: "+34600111222", externalAppId: `x-${suffix}`, webhookToken: `cat-${suffix}` }),
      );
    expect(pgCode(await settle(insertChannel()))).toBe("42501");
    // Locked while pending: the tenant cannot relabel itself out of the review.
    const relabel = await settle(withTenant(app.db, s.a, (tx) => tx.execute(sql`select public.tenant_set_business_category(${s.a}::uuid, 'comercio_minorista', null)`)));
    expect(pgCode(relabel)).toBe("55000");
    // The app role cannot flip the review columns directly.
    const direct = await settle(withTenant(app.db, s.a, (tx) => tx.update(tenants).set({ categoryReviewStatus: "approved" }).where(eq(tenants.id, s.a))));
    expect(pgCode(direct)).toBe("42501");

    const queue = await app.sql<{ tenant_id: string }[]>`select tenant_id from public.platform_category_review_list(${s.admin}, 'pending')`;
    expect(queue.map((r) => r.tenant_id)).toContain(s.a);
    expect(pgCode(await settle(app.sql`select public.platform_category_review_decide(${s.a}, ${s.a}, true, null, null)`))).toBe("42501");
    await app.sql`select public.platform_category_review_decide(${s.admin}, ${s.a}, true, null, '127.0.0.1'::inet)`;
    await insertChannel();
    const audit = await migrator.sql<{ action: string }[]>`select action from platform_audit_events where tenant_id = ${s.a}`;
    expect(audit.map((r) => r.action)).toContain("tenant.category_approved");
  });

  it("lets admins edit rules (audited) and never touches existing tenants", async () => {
    await withTenant(app.db, s.b, (tx) => tx.execute(sql`select public.tenant_set_business_category(${s.b}::uuid, 'inmobiliaria', null)`));
    const key = `test_${suffix.replace(/-/g, "")}`;
    await app.sql`select public.platform_business_category_upsert(${s.admin}, ${key}, 'Test', 'warn', 'guía', 10, true, null)`;
    await app.sql`select public.platform_business_category_upsert(${s.admin}, 'inmobiliaria', 'Inmobiliaria', 'review', null, 60, true, null)`;
    const [t] = await migrator.sql<{ category_review_status: string }[]>`select category_review_status from tenants where id = ${s.b}`;
    expect(t?.category_review_status).toBe("none");
    await app.sql`select public.platform_business_category_upsert(${s.admin}, 'inmobiliaria', 'Inmobiliaria', 'allow', null, 60, true, null)`;
    await migrator.sql`delete from business_categories where key = ${key}`;
    const audit = await migrator.sql<{ n: number }[]>`select count(*)::int as n from platform_audit_events where action = 'category.upserted' and diff->>'key' = ${key}`;
    expect(audit[0]?.n).toBe(1);
  });
});
