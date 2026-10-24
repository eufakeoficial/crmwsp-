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
const tokenHash = (): Buffer => createHash("sha256").update(randomBytes(32)).digest();

describe.skipIf(!hasDb)("email verification (0095)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const created: { userId: string; tenantId: string }[] = [];

  const signup = async (tag: string) => {
    const [row] = await app.sql<{ user_id: string; tenant_id: string }[]>`
      select * from public.signup_tenant(${`verify-${tag}-${suffix}@example.test`}, ${"Ana"}, ${"scrypt$dummy"}, ${`Tenant ${tag}`}, ${`verify-${tag}-${suffix}`})`;
    if (!row) throw new Error("signup failed");
    const ids = { userId: row.user_id, tenantId: row.tenant_id };
    created.push(ids);
    return ids;
  };
  const issue = async (userId: string, hash: Buffer, ttl = 86400) =>
    app.sql<{ user_id: string }[]>`select * from public.email_verification_issue(${userId}::uuid, ${hash}, ${ttl})`;
  const consume = async (hash: Buffer) => {
    const [r] = await app.sql<{ u: string | null }[]>`select public.email_verification_consume(${hash}) as u`;
    return r?.u ?? null;
  };
  const verifiedAt = async (userId: string) => {
    const [r] = await app.sql<{ v: Date | null }[]>`select public.user_email_verified_at(${userId}::uuid) as v`;
    return r?.v ?? null;
  };
  const ownerVerified = (tenantId: string, ctx: string) =>
    withTenant(app.db, ctx, async (tx) => {
      const [r] = await tx.execute<{ ok: boolean }>(sql`select public.tenant_owner_email_verified(${tenantId}::uuid) as ok`);
      return r?.ok;
    });

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

  it("app role cannot touch email_verification_tokens directly", async () => {
    for (const stmt of [sql`select * from email_verification_tokens`, sql`update email_verification_tokens set used_at = null`]) {
      expect(pgCause(await settle(app.db.execute(stmt)))?.code).toBe("42501");
    }
  });

  it("new users start unverified; a token verifies exactly once", async () => {
    const { userId, tenantId } = await signup("a");
    expect(await verifiedAt(userId)).toBeNull();
    expect(await ownerVerified(tenantId, tenantId)).toBe(false);
    const hash = tokenHash();
    expect((await issue(userId, hash))[0]?.user_id).toBe(userId);
    expect(await consume(hash)).toBe(userId);
    expect(await consume(hash)).toBeNull();
    expect(await verifiedAt(userId)).not.toBeNull();
    expect(await ownerVerified(tenantId, tenantId)).toBe(true);
    // Already verified: no new token is issued.
    expect(await issue(userId, tokenHash())).toHaveLength(0);
  });

  it("a new token invalidates the previous one; expired tokens are rejected", async () => {
    const { userId } = await signup("b");
    const first = tokenHash();
    const second = tokenHash();
    await issue(userId, first);
    await issue(userId, second);
    expect(await consume(first)).toBeNull();
    await migrator.db.execute(sql`update email_verification_tokens set expires_at = now() - interval '1 second' where token_hash = ${second}`);
    expect(await consume(second)).toBeNull();
    expect(await verifiedAt(userId)).toBeNull();
  });

  it("tenant_owner_email_verified only answers for the caller's tenant context", async () => {
    const a = await signup("c");
    const b = await signup("d");
    await migrator.db.execute(sql`update users set email_verified_at = now() where id = ${a.userId}::uuid`);
    expect(await ownerVerified(a.tenantId, a.tenantId)).toBe(true);
    expect(await ownerVerified(a.tenantId, b.tenantId)).toBe(false);
  });
});
