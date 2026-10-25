import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { withTenant } from "../with-tenant.js";
import { tenants, users } from "../schema/index.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string };
const pgCause = (err: unknown): PgCause | undefined => (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);
const codeHash = (): Buffer => createHash("sha256").update(randomBytes(32)).digest();

describe.skipIf(!hasDb)("woocommerce connect codes (0096)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const created: { userId: string; tenantId: string }[] = [];

  const signup = async (tag: string) => {
    const [row] = await app.sql<{ user_id: string; tenant_id: string }[]>`
      select * from public.signup_tenant(${`connect-${tag}-${suffix}@example.test`}, ${"Ana"}, ${"scrypt$dummy"}, ${`Tenant ${tag}`}, ${`connect-${tag}-${suffix}`})`;
    if (!row) throw new Error("signup failed");
    const ids = { userId: row.user_id, tenantId: row.tenant_id };
    created.push(ids);
    return ids;
  };
  const issue = (tenantId: string, userId: string, hash: Buffer, ctx: string = tenantId, ttl = 900) =>
    withTenant(app.db, ctx, async (tx) => {
      const rows = await tx.execute<{ expires_at: Date }>(
        sql`select expires_at from public.connect_code_issue(${tenantId}::uuid, ${userId}::uuid, ${hash}, ${ttl})`,
      );
      return rows[0]?.expires_at ?? null;
    });
  const consume = async (hash: Buffer) => {
    const [r] = await app.sql<{ tenant_id: string; created_by: string; tenant_name: string }[]>`
      select * from public.connect_code_consume(${hash})`;
    return r ?? null;
  };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
  });

  afterAll(async () => {
    if (migrator) {
      if (created.length) await migrator.db.delete(tenants).where(inArray(tenants.id, created.map((c) => c.tenantId)));
      for (const c of created) await migrator.db.delete(users).where(eq(users.id, c.userId));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("app role cannot touch integration_connect_codes directly", async () => {
    for (const stmt of [sql`select * from integration_connect_codes`, sql`update integration_connect_codes set used_at = null`]) {
      expect(pgCause(await settle(app.db.execute(stmt)))?.code).toBe("42501");
    }
  });

  it("issue requires the tenant's own transaction context", async () => {
    const a = await signup("a");
    const b = await signup("b");
    expect(await issue(a.tenantId, a.userId, codeHash(), b.tenantId)).toBeNull();
    const [none] = await app.sql<{ n: number }[]>`
      select count(*)::int as n from public.connect_code_issue(${a.tenantId}::uuid, ${a.userId}::uuid, ${codeHash()}, 900)`;
    expect(none?.n).toBe(0);
    expect(await issue(a.tenantId, a.userId, codeHash())).not.toBeNull();
  });

  it("a code is consumed exactly once and returns the tenant and issuer", async () => {
    const a = await signup("c");
    const hash = codeHash();
    await issue(a.tenantId, a.userId, hash);
    const r = await consume(hash);
    expect(r?.tenant_id).toBe(a.tenantId);
    expect(r?.created_by).toBe(a.userId);
    expect(r?.tenant_name).toBe("Tenant c");
    expect(await consume(hash)).toBeNull();
  });

  it("a new code voids the previous one; expired codes are rejected", async () => {
    const a = await signup("d");
    const first = codeHash();
    const second = codeHash();
    await issue(a.tenantId, a.userId, first);
    await issue(a.tenantId, a.userId, second);
    expect(await consume(first)).toBeNull();
    await migrator.db.execute(sql`update integration_connect_codes set expires_at = now() - interval '1 second' where code_hash = ${second}`);
    expect(await consume(second)).toBeNull();
  });

  it("an inactive tenant cannot issue or consume", async () => {
    const a = await signup("e");
    const hash = codeHash();
    await issue(a.tenantId, a.userId, hash);
    await migrator.db.execute(sql`update tenants set status = 'suspended' where id = ${a.tenantId}::uuid`);
    expect(await consume(hash)).toBeNull();
    expect(await issue(a.tenantId, a.userId, codeHash())).toBeNull();
  });
});
