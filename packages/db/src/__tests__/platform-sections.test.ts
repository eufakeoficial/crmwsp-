import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { channelConnections, memberships, tenants, users } from "../schema/index.js";
import { dangerouslyWithoutTenant } from "../with-tenant.js";

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
const keys = (row: Record<string, unknown> | undefined) => Object.keys(row ?? {}).sort();

describe.skipIf(!hasDb)("platform backoffice sections (0057 definer functions)", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const s = { admin: "", owner: "", tenant: "" };
  const month = new Date().toISOString().slice(0, 7);

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, o] = await tx
        .insert(users)
        .values([
          { email: `sadmin-${suffix}@example.test`, name: "Admin" },
          { email: `sowner-${suffix}@example.test`, name: "Sofía" },
        ])
        .returning({ id: users.id });
      s.admin = a!.id;
      s.owner = o!.id;
      const [t] = await tx.insert(tenants).values({ slug: `ps-${suffix}`, name: `Sec ${suffix}` }).returning({ id: tenants.id });
      s.tenant = t!.id;
      await tx.insert(memberships).values({ tenantId: s.tenant, userId: s.owner, role: "owner" });
      await tx.insert(channelConnections).values({
        tenantId: s.tenant,
        provider: "gupshup",
        phoneE164: "+34600999123",
        externalAppId: `app-${suffix}`,
        webhookToken: `whs-${suffix}`,
        status: "active",
      });
    });
    await migrator.sql`insert into platform_admins (user_id) values (${s.admin})`;
    await migrator.sql`insert into sessions (user_id, token_hash, expires_at) values (${s.owner}, ${randomBytes(32)}, now() + interval '1 day')`;
    await migrator.sql`insert into usage_counters (tenant_id, period, limit_key, used) values (${s.tenant}, ${month}, 'ai_messages', 42)`;
    await migrator.sql`
      insert into usage_ledger (tenant_id, kind, quantity, unit, cost_minor, currency) values
        (${s.tenant}, 'llm_tokens', 1000, 'token', 250000000, 'USD'),
        (${s.tenant}, 'tts_characters', 1200, 'character', 0, 'USD')`;
    await migrator.sql`
      insert into tenant_plans (tenant_id, plan, limits_override) values (${s.tenant}, 'start', '{"seats": 9}'::jsonb)
      on conflict (tenant_id) do update set limits_override = excluded.limits_override`;
  });

  afterAll(async () => {
    if (migrator) {
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        if (s.tenant) await tx.delete(tenants).where(inArray(tenants.id, [s.tenant]));
        await tx.delete(users).where(inArray(users.id, [s.admin, s.owner].filter(Boolean)));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("every new function refuses an actor without a platform_admins row", async () => {
    const calls = [
      app.sql`select * from public.platform_user_list(${s.owner}, null)`,
      app.sql`select public.platform_revoke_user_sessions(${s.owner}, ${s.owner}, null)`,
      app.sql`select * from public.platform_channel_list(${s.owner}, null)`,
      app.sql`select * from public.platform_plan_counts(${s.owner})`,
      app.sql`select * from public.platform_limit_overrides(${s.owner})`,
      app.sql`select * from public.platform_usage(${s.owner}, ${month})`,
      app.sql`select * from public.platform_audit_search(${s.owner}, null, null, null, null, null, 10, 0)`,
      app.sql`select * from public.platform_user_list(null, null)`,
    ];
    for (const c of calls) expect(pgCode(await settle(c))).toBe("42501");
    const sessions = await settle(app.sql`select * from public.sessions limit 1`);
    expect(pgCode(sessions)).toBe("42501");
  });

  it("users: whitelisted columns, tenants with role, admin flag", async () => {
    const rows = await app.sql<Record<string, unknown>[]>`select * from public.platform_user_list(${s.admin}, ${suffix})`;
    expect(rows).toHaveLength(2);
    expect(keys(rows[0])).toEqual(["active_sessions", "created_at", "email", "is_platform_admin", "last_login_at", "name", "tenants", "user_id"]);
    const owner = rows.find((r) => r["user_id"] === s.owner)!;
    expect(owner).toMatchObject({ active_sessions: 1, is_platform_admin: false, tenants: [{ tenantId: s.tenant, name: `Sec ${suffix}`, role: "owner" }] });
    expect(owner["last_login_at"]).not.toBeNull();
    expect(rows.find((r) => r["user_id"] === s.admin)?.["is_platform_admin"]).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/token|password|scrypt/i);
  });

  it("revoking sessions ends them and is audited", async () => {
    const [r] = await app.sql<{ n: number }[]>`select public.platform_revoke_user_sessions(${s.admin}, ${s.owner}, '10.0.0.2') as n`;
    expect(r?.n).toBe(1);
    const [u] = await app.sql<{ active_sessions: number }[]>`select active_sessions from public.platform_user_list(${s.admin}, null, ${s.owner})`;
    expect(u?.active_sessions).toBe(0);
    const audit = await app.sql<{ action: string; diff: Record<string, unknown> }[]>`
      select action, diff from public.platform_audit_search(${s.admin}, ${`sadmin-${suffix}`}, 'user.', null, null, null, 10, 0)`;
    expect(audit[0]).toMatchObject({ action: "user.sessions_revoked", diff: { userId: s.owner, revoked: 1 } });
    expect(pgCode(await settle(app.sql`select public.platform_revoke_user_sessions(${s.admin}, ${randomUUID()}, null)`))).toBe("P0002");
  });

  it("channels: last 4 digits only, never tokens or app ids", async () => {
    const rows = await app.sql<Record<string, unknown>[]>`select * from public.platform_channel_list(${s.admin}, 'active')`;
    const mine = rows.find((r) => r["tenant_id"] === s.tenant)!;
    expect(keys(mine)).toEqual([
      "channel_id",
      "created_at",
      "failed_7d",
      "last_inbound_at",
      "last_outbound_at",
      "phone_last4",
      "provider",
      "status",
      "tenant_id",
      "tenant_name",
    ]);
    expect(mine).toMatchObject({ phone_last4: "9123", provider: "gupshup", failed_7d: 0 });
    expect(JSON.stringify(rows)).not.toContain(`whs-${suffix}`);
    expect(JSON.stringify(rows)).not.toContain("600999");
    expect(pgCode(await settle(app.sql`select * from public.platform_channel_list(${s.admin}, 'nope')`))).toBe("22023");
  });

  it("plans: counts per plan and the tenants with overrides", async () => {
    const counts = await app.sql<{ plan: string; status: string; tenant_count: number }[]>`select * from public.platform_plan_counts(${s.admin})`;
    expect(counts.find((c) => c.plan === "start" && c.status === "active")?.tenant_count).toBeGreaterThanOrEqual(1);
    const ov = await app.sql<Record<string, unknown>[]>`select * from public.platform_limit_overrides(${s.admin})`;
    const mine = ov.find((r) => r["tenant_id"] === s.tenant)!;
    expect(keys(mine)).toEqual(["limits_override", "name", "plan", "slug", "status", "tenant_id", "updated_at"]);
    expect(mine["limits_override"]).toEqual({ seats: 9 });
  });

  it("usage: counters, tts characters and AI cost of the month", async () => {
    const rows = await app.sql<Record<string, unknown>[]>`select * from public.platform_usage(${s.admin}, ${month})`;
    const mine = rows.find((r) => r["tenant_id"] === s.tenant)!;
    expect(keys(mine)).toEqual(["ai_cost_micro", "ai_messages", "broadcast_sends", "name", "plan", "slug", "tenant_id", "tts_characters"]);
    expect(mine).toMatchObject({ ai_messages: "42", broadcast_sends: "0", tts_characters: "1200", ai_cost_micro: "250000000" });
    const empty = await app.sql`select * from public.platform_usage(${s.admin}, '2001-01') where tenant_id = ${s.tenant}`;
    expect(empty).toHaveLength(0);
    expect(pgCode(await settle(app.sql`select * from public.platform_usage(${s.admin}, '2026-13')`))).toBe("22023");
  });

  it("audit search filters and paginates with a total count", async () => {
    const all = await app.sql<{ total_count: string }[]>`
      select * from public.platform_audit_search(${s.admin}, null, null, null, null, null, 1, 0)`;
    expect(all).toHaveLength(1);
    expect(Number(all[0]?.total_count)).toBeGreaterThanOrEqual(1);
    const future = await app.sql`select * from public.platform_audit_search(${s.admin}, null, null, null, now() + interval '1 day', null, 10, 0)`;
    expect(future).toHaveLength(0);
    expect(pgCode(await settle(app.sql`select * from public.platform_audit_search(${s.admin}, null, null, null, null, null, 10, -1)`))).toBe("22023");
  });
});
