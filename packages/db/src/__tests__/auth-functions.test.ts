import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { sessions, tenants, users } from "../schema/index.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string; message?: string };
const pgCause = (err: unknown): PgCause | undefined =>
  (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );
const tokenHash = (): Buffer => createHash("sha256").update(randomBytes(32)).digest();
const TTL = 30 * 24 * 3600;

describe.skipIf(!hasDb)("auth SECURITY DEFINER functions with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const email = `auth-${suffix}@example.test`;
  let userId: string;
  let tenantId: string;

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    const rows = await app.sql<{ user_id: string; tenant_id: string }[]>`
      select * from public.signup_tenant(${email}, ${"Ana"}, ${"scrypt$dummy"}, ${"Tenant Auth"}, ${`auth-${suffix}`})`;
    const row = rows[0];
    if (!row) throw new Error("signup failed");
    userId = row.user_id;
    tenantId = row.tenant_id;
  });

  afterAll(async () => {
    if (migrator) {
      if (tenantId) await migrator.db.delete(tenants).where(inArray(tenants.id, [tenantId]));
      if (userId) await migrator.db.delete(users).where(eq(users.id, userId));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("app role cannot SELECT/INSERT/UPDATE/DELETE user_credentials or sessions", async () => {
    for (const stmt of [
      sql`select * from user_credentials`,
      sql`select * from sessions`,
      sql`insert into sessions (user_id, token_hash, expires_at) values (gen_random_uuid(), '\\x00', now())`,
      sql`update user_credentials set password_hash = 'x'`,
      sql`delete from sessions`,
    ]) {
      const err = await settle(app.db.execute(stmt));
      expect(pgCause(err)?.code).toBe("42501");
    }
  });

  it("signup_tenant creates user, credentials, tenant and owner membership", async () => {
    const login = await app.sql<{ user_id: string; password_hash: string }[]>`
      select * from public.auth_login(${email.toUpperCase()})`;
    expect(login).toEqual([{ user_id: userId, password_hash: "scrypt$dummy" }]);
    const tenantsOf = await app.sql<{ tenant_id: string; role: string; slug: string }[]>`
      select * from public.list_user_tenants(${userId})`;
    expect(tenantsOf).toHaveLength(1);
    expect(tenantsOf[0]).toMatchObject({ tenant_id: tenantId, role: "owner", slug: `auth-${suffix}` });
  });

  it("auth_login returns no row for an unknown email", async () => {
    const rows = await app.sql`select * from public.auth_login(${`nobody-${suffix}@example.test`})`;
    expect(rows).toHaveLength(0);
  });

  it("signup with a duplicate email (any case) or slug fails with a generic error", async () => {
    const dupEmail = await settle(
      app.sql`select * from public.signup_tenant(${email.toUpperCase()}, ${"X"}, ${"h"}, ${"Other"}, ${`other-${suffix}`})`,
    );
    expect(pgCause(dupEmail)?.code).toBe("23505");
    expect(pgCause(dupEmail)?.message).toBe("signup_tenant: signup rejected");
    const dupSlug = await settle(
      app.sql`select * from public.signup_tenant(${`new-${suffix}@example.test`}, ${"X"}, ${"h"}, ${"Other"}, ${`auth-${suffix}`})`,
    );
    expect(pgCause(dupSlug)?.code).toBe("23505");
    expect(pgCause(dupSlug)?.message).toBe("signup_tenant: signup rejected");
    // Nothing partially created.
    const left = await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, `new-${suffix}@example.test`));
    expect(left).toHaveLength(0);
  });

  it("session lifecycle: create, resolve (sliding), revoke", async () => {
    const hash = tokenHash();
    const created = await app.sql<{ session_id: string; expires_at: Date }[]>`
      select * from public.create_session(${userId}, ${hash}, ${"203.0.113.7"}, ${"vitest"}, ${TTL})`;
    expect(created).toHaveLength(1);
    const resolved = await app.sql<{ user_id: string; email: string }[]>`
      select * from public.resolve_session(${hash}, ${TTL})`;
    expect(resolved[0]).toMatchObject({ user_id: userId, email });

    // Sliding: an old expires_at gets pushed forward on resolve.
    await migrator.db
      .update(sessions)
      .set({ expiresAt: sql`now() + interval '1 hour'` })
      .where(eq(sessions.tokenHash, hash));
    await app.sql`select * from public.resolve_session(${hash}, ${TTL})`;
    const [slid] = await migrator.db.select({ e: sessions.expiresAt }).from(sessions).where(eq(sessions.tokenHash, hash));
    expect(slid!.e.getTime()).toBeGreaterThan(Date.now() + (TTL - 60) * 1000);

    const [rev] = await app.sql<{ revoke_session: boolean }[]>`select public.revoke_session(${hash})`;
    expect(rev?.revoke_session).toBe(true);
    expect(await app.sql`select * from public.resolve_session(${hash}, ${TTL})`).toHaveLength(0);
    const [again] = await app.sql<{ revoke_session: boolean }[]>`select public.revoke_session(${hash})`;
    expect(again?.revoke_session).toBe(false);
  });

  it("expired sessions do not resolve", async () => {
    const hash = tokenHash();
    await app.sql`select * from public.create_session(${userId}, ${hash}, ${null}, ${null}, ${TTL})`;
    await migrator.db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessions.tokenHash, hash));
    expect(await app.sql`select * from public.resolve_session(${hash}, ${TTL})`).toHaveLength(0);
  });

  it("sliding expiration has an absolute cap of 90 days from created_at", async () => {
    const old = tokenHash();
    await app.sql`select * from public.create_session(${userId}, ${old}, ${null}, ${null}, ${TTL})`;
    await migrator.db
      .update(sessions)
      .set({ createdAt: sql`now() - interval '91 days'`, expiresAt: sql`now() + interval '1 day'` })
      .where(eq(sessions.tokenHash, old));
    expect(await app.sql`select * from public.resolve_session(${old}, ${TTL})`).toHaveLength(0);

    const near = tokenHash();
    await app.sql`select * from public.create_session(${userId}, ${near}, ${null}, ${null}, ${TTL})`;
    await migrator.db
      .update(sessions)
      .set({ createdAt: sql`now() - interval '89 days'` })
      .where(eq(sessions.tokenHash, near));
    const [r] = await app.sql<{ expires_at: string | Date }[]>`select * from public.resolve_session(${near}, ${TTL})`;
    // Slid to at most created_at + 90 days (~1 day from now), not now() + 30 days.
    expect(new Date(r!.expires_at).getTime()).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000 + 60_000);
    expect(new Date(r!.expires_at).getTime()).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
  });

  it("auth_login matches exactly one email and cannot be used to list users", async () => {
    for (const probe of ["%", "%@example.test", `${email.slice(0, 5)}%`, "", null]) {
      expect(await app.sql`select * from public.auth_login(${probe})`).toHaveLength(0);
    }
    expect(await app.sql`select * from public.auth_login(${email.toUpperCase()})`).toHaveLength(1);
  });

  it("signup_tenant rejects invalid slugs and lower-cases the email", async () => {
    for (const slug of ["ab", "-abc", "abc-", "ABC", "a_b_c", "x".repeat(64)]) {
      const err = await settle(app.sql`select * from public.signup_tenant(${`s-${slug}-${suffix}@example.test`}, ${"X"}, ${"h"}, ${"T"}, ${slug})`);
      expect(pgCause(err)?.code).toBe("22023");
    }
    const mixed = `MiXeD-${suffix}@Example.TEST`;
    const [row] = await app.sql<{ user_id: string; tenant_id: string }[]>`
      select * from public.signup_tenant(${mixed}, ${"M"}, ${"h"}, ${"T"}, ${`mixed-${suffix}`})`;
    const [u] = await migrator.db.select({ email: users.email }).from(users).where(eq(users.id, row!.user_id));
    expect(u?.email).toBe(mixed.toLowerCase());
    await migrator.db.delete(tenants).where(eq(tenants.id, row!.tenant_id));
    await migrator.db.delete(users).where(eq(users.id, row!.user_id));
  });

  it("create_session rejects malformed token hashes and ttl", async () => {
    const bad = await settle(app.sql`select * from public.create_session(${userId}, ${Buffer.alloc(8)}, ${null}, ${null}, ${TTL})`);
    expect(pgCause(bad)?.code).toBe("22023");
    const badTtl = await settle(app.sql`select * from public.create_session(${userId}, ${tokenHash()}, ${null}, ${null}, ${10})`);
    expect(pgCause(badTtl)?.code).toBe("22023");
  });

  it("functions are not executable by PUBLIC", async () => {
    const rows = await migrator.sql<{ proname: string; public_exec: boolean; app_exec: boolean }[]>`
      select p.proname,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
             has_function_privilege('crmwsp_app', p.oid, 'EXECUTE') as app_exec
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('auth_login','create_session','resolve_session','revoke_session','list_user_tenants','signup_tenant')`;
    expect(rows).toHaveLength(6);
    for (const r of rows) {
      expect(r.public_exec).toBe(false);
      expect(r.app_exec).toBe(true);
    }
  });
});
