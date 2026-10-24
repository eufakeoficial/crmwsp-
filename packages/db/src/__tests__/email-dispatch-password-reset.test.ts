import { createHash, randomBytes, randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { tenants, users } from "../schema/index.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string };
const pgCause = (err: unknown): PgCause | undefined => (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);
const tokenHash = (): Buffer => createHash("sha256").update(randomBytes(32)).digest();
const NEW_HASH = "scrypt$new-password-hash-0123456789";

describe.skipIf(!hasDb)("email_dispatches + password reset (0074)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const email = `reset-${suffix}@example.test`;
  let userId = "";
  let tenantId = "";

  const request = async (addr: string, hash: Buffer, ttl = 1800) =>
    app.sql<{ user_id: string; email: string }[]>`select * from public.password_reset_request(${addr}, ${hash}, ${ttl}, ${"10.0.0.9"})`;
  const consume = async (hash: Buffer) => {
    const [r] = await app.sql<{ u: string | null }[]>`select public.password_reset_consume(${hash}, ${NEW_HASH}) as u`;
    return r?.u ?? null;
  };

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    const [row] = await app.sql<{ user_id: string; tenant_id: string }[]>`
      select * from public.signup_tenant(${email}, ${"Ana"}, ${"scrypt$dummy"}, ${"Tenant Reset"}, ${`reset-${suffix}`})`;
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

  it("app role cannot touch email_dispatches or password_reset_tokens directly", async () => {
    for (const stmt of [
      sql`select * from email_dispatches`,
      sql`insert into email_dispatches (dedupe_key, template) values ('x', 'y')`,
      sql`select * from password_reset_tokens`,
      sql`update password_reset_tokens set used_at = null`,
    ]) {
      expect(pgCause(await settle(app.db.execute(stmt)))?.code).toBe("42501");
    }
  });

  it("email_dispatch_claim is true only once per key", async () => {
    const key = `test:${suffix}`;
    const claim = async () => (await app.sql<{ ok: boolean }[]>`select public.email_dispatch_claim(${key}, ${"bienvenida"}, ${tenantId}::uuid) as ok`)[0]?.ok;
    expect(await claim()).toBe(true);
    expect(await claim()).toBe(false);
  });

  it("unknown emails get no row (the API answers the same)", async () => {
    expect(await request(`nobody-${suffix}@example.test`, tokenHash())).toHaveLength(0);
  });

  it("a token is single use, sets the password and revokes every session", async () => {
    const session = tokenHash();
    await app.sql`select * from public.create_session(${userId}, ${session}, ${null}, ${null}, ${3600})`;
    const hash = tokenHash();
    expect((await request(email.toUpperCase(), hash))[0]?.user_id).toBe(userId);
    expect(await consume(hash)).toBe(userId);
    expect(await consume(hash)).toBeNull();
    expect(await app.sql`select * from public.resolve_session(${session}, ${3600})`).toHaveLength(0);
    const [login] = await app.sql<{ password_hash: string }[]>`select password_hash from public.auth_login(${email})`;
    expect(login?.password_hash).toBe(NEW_HASH);
  });

  it("a new request invalidates the previous token", async () => {
    const first = tokenHash();
    const second = tokenHash();
    await request(email, first);
    await request(email, second);
    expect(await consume(first)).toBeNull();
    expect(await consume(second)).toBe(userId);
  });

  it("an expired token is rejected", async () => {
    const hash = tokenHash();
    await request(email, hash);
    await migrator.db.execute(sql`update password_reset_tokens set expires_at = now() - interval '1 second' where token_hash = ${hash}`);
    expect(await consume(hash)).toBeNull();
  });
});
