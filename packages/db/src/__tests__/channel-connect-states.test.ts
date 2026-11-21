import { createHash, randomBytes, randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, tenants, users } from "../schema/index.js";
import { withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

type PgCause = { code?: string };
const pgCause = (err: unknown): PgCause | undefined => (err as Error & { cause?: PgCause } | undefined)?.cause ?? (err as PgCause | undefined);
const settle = <T>(p: Promise<T>): Promise<unknown> => p.then(() => undefined, (err: unknown) => err);
const newHash = (): Buffer => createHash("sha256").update(randomBytes(32)).digest();

describe.skipIf(!hasDb)("channel connect states + cross-tenant ownership (0090)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const made: Array<{ user_id: string; tenant_id: string }> = [];
  const channelId = `CH_${suffix}`;

  const asTenant = <T>(i: number, fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(app.db, made[i]!.tenant_id, fn, { userId: made[i]!.user_id });
  const one = async <T>(i: number, q: ReturnType<typeof sql>): Promise<T> =>
    asTenant(i, async (tx) => {
      const rows = await tx.execute<{ v: T }>(q);
      return [...rows][0]!.v;
    });

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    for (const n of ["a", "b"]) {
      const [row] = await app.sql<{ user_id: string; tenant_id: string }[]>`
        select * from public.signup_tenant(${`cs-${n}-${suffix}@example.test`}, ${"Ana"}, ${"scrypt$dummy"}, ${`Tenant ${n}`}, ${`cs-${n}-${suffix}`})`;
      if (!row) throw new Error("signup failed");
      made.push(row);
    }
    await asTenant(0, (tx) =>
      tx.insert(channelConnections).values({
        tenantId: made[0]!.tenant_id,
        provider: "360dialog",
        phoneE164: "+5491140009999",
        externalAppId: channelId,
        webhookToken: randomBytes(32).toString("base64url"),
        status: "active",
      }),
    );
  });

  afterAll(async () => {
    if (migrator) {
      const ids = made.map((m) => m.tenant_id);
      if (ids.length) await migrator.db.delete(tenants).where(inArray(tenants.id, ids));
      const uids = made.map((m) => m.user_id);
      if (uids.length) await migrator.db.delete(users).where(inArray(users.id, uids));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("app role cannot read or write channel_connect_states directly", async () => {
    expect(pgCause(await settle(app.db.execute(sql`select * from channel_connect_states`)))?.code).toBe("42501");
  });

  it("reports ids connected by another tenant, never the caller's own, and nothing without context", async () => {
    const forB = await asTenant(1, async (tx) => [...(await tx.execute<{ x: string }>(sql`select x from public.channel_external_owned_elsewhere('360dialog', ARRAY[${channelId}, 'nope']::text[]) x`))]);
    expect(forB.map((r) => r.x)).toEqual([channelId]);
    const forA = await asTenant(0, async (tx) => [...(await tx.execute<{ x: string }>(sql`select x from public.channel_external_owned_elsewhere('360dialog', ARRAY[${channelId}]::text[]) x`))]);
    expect(forA).toHaveLength(0);
    const noCtx = await app.sql<{ x: string }[]>`select x from public.channel_external_owned_elsewhere('360dialog', ARRAY[${channelId}]::text[]) x`;
    expect(noCtx).toHaveLength(0);
  });

  it("a state is single use and bound to the issuing tenant + user", async () => {
    const h = newHash();
    expect(await one<string | null>(0, sql`select public.channel_connect_state_issue('360dialog', ${h}, 900)::text as v`)).not.toBeNull();
    expect(await one<boolean>(1, sql`select public.channel_connect_state_check('360dialog', ${h}) as v`)).toBe(false);
    expect(await one<boolean>(1, sql`select public.channel_connect_state_consume('360dialog', ${h}) as v`)).toBe(false);
    expect(await one<boolean>(0, sql`select public.channel_connect_state_check('360dialog', ${h}) as v`)).toBe(true);
    expect(await one<boolean>(0, sql`select public.channel_connect_state_consume('360dialog', ${h}) as v`)).toBe(true);
    expect(await one<boolean>(0, sql`select public.channel_connect_state_consume('360dialog', ${h}) as v`)).toBe(false);
    expect(await one<boolean>(0, sql`select public.channel_connect_state_check('360dialog', ${h}) as v`)).toBe(false);
  });

  it("an expired state is refused", async () => {
    const h = newHash();
    await one(0, sql`select public.channel_connect_state_issue('360dialog', ${h}, 60)::text as v`);
    await migrator.db.execute(sql`update public.channel_connect_states set expires_at = now() - interval '1 second' where state_hash = ${h}`);
    expect(await one<boolean>(0, sql`select public.channel_connect_state_consume('360dialog', ${h}) as v`)).toBe(false);
  });
});
