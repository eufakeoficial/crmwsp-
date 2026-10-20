import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { readPlanUsage } from "../plan-usage.js";
import { channelConnections, memberships, tenants, users } from "../schema/index.js";
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

const LIST_COLUMNS = [
  "ai_messages",
  "broadcast_sends",
  "channel_count",
  "created_at",
  "last_activity_at",
  "limits_override",
  "member_count",
  "name",
  "overdue",
  "owner_email",
  "owner_name",
  "paid_until",
  "period",
  "plan",
  "seats",
  "slug",
  "status",
  "status_reason",
  "tenant_id",
];

describe.skipIf(!hasDb)("platform admin: table privileges and definer functions", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const s = { admin: "", owner: "", tenant: "", other: "" };
  const userIds: string[] = [];
  const tenantIds: string[] = [];

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    await dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const [a, o] = await tx
        .insert(users)
        .values([
          { email: `padmin-${suffix}@example.test`, name: "Admin" },
          { email: `powner-${suffix}@example.test`, name: "Olga" },
        ])
        .returning({ id: users.id });
      s.admin = a!.id;
      s.owner = o!.id;
      userIds.push(s.admin, s.owner);
      const [t, t2] = await tx
        .insert(tenants)
        .values([
          { slug: `pa-${suffix}`, name: `Plat A ${suffix}` },
          { slug: `pb-${suffix}`, name: `Plat B ${suffix}` },
        ])
        .returning({ id: tenants.id });
      s.tenant = t!.id;
      s.other = t2!.id;
      tenantIds.push(s.tenant, s.other);
      await tx.insert(memberships).values({ tenantId: s.tenant, userId: s.owner, role: "owner" });
      await tx.insert(channelConnections).values({
        tenantId: s.tenant,
        provider: "gupshup",
        phoneE164: "+34600111222",
        webhookToken: `wh-${suffix}`,
        status: "active",
      });
    });
    await migrator.sql`insert into platform_admins (user_id) values (${s.admin})`;
  });

  afterAll(async () => {
    if (migrator) {
      await migrator.sql`update platform_settings set require_approval = false where id = 1`;
      await dangerouslyWithoutTenant(migrator.db, async (tx) => {
        if (tenantIds.length) await tx.delete(tenants).where(inArray(tenants.id, tenantIds));
        if (userIds.length) await tx.delete(users).where(inArray(users.id, userIds));
      });
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("the app role cannot touch the platform tables directly", async () => {
    for (const table of ["platform_admins", "platform_settings", "platform_audit_events", "subscription_payments"]) {
      const err = await settle(app.sql.unsafe(`select * from public.${table} limit 1`));
      expect(pgCode(err), table).toBe("42501");
    }
    const ins = await settle(app.sql`insert into platform_admins (user_id) values (${s.owner})`);
    expect(pgCode(ins)).toBe("42501");
    const inTenant = await settle(withTenant(app.db, s.tenant, (tx) => tx.execute("select * from subscription_payments" as never)));
    expect(pgCode(inTenant)).toBe("42501");
  });

  it("platform_is_admin only for rows in platform_admins", async () => {
    const [yes] = await app.sql<{ v: boolean }[]>`select public.platform_is_admin(${s.admin}) as v`;
    const [no] = await app.sql<{ v: boolean }[]>`select public.platform_is_admin(${s.owner}) as v`;
    expect(yes?.v).toBe(true);
    expect(no?.v).toBe(false);
  });

  it("every platform function refuses a non-admin actor", async () => {
    const calls = [
      app.sql`select * from public.platform_tenant_list(${s.owner}, null, null, null)`,
      app.sql`select * from public.platform_tenant_members(${s.owner}, ${s.tenant})`,
      app.sql`select * from public.platform_tenant_channels(${s.owner}, ${s.tenant})`,
      app.sql`select * from public.platform_set_tenant_status(${s.owner}, ${s.tenant}, 'suspend', 'x', null)`,
      app.sql`select public.platform_set_tenant_plan(${s.owner}, ${s.tenant}, 'pro', null, null)`,
      app.sql`select public.platform_dashboard(${s.owner})`,
      app.sql`select * from public.platform_get_settings(${s.owner})`,
      app.sql`select public.platform_set_require_approval(${s.owner}, true, null)`,
      app.sql`select * from public.platform_list_payments(${s.owner}, null, null, null)`,
      app.sql`select * from public.platform_payment_totals(${s.owner}, 3)`,
      app.sql`select * from public.platform_audit_list(${s.owner}, null, 10)`,
    ];
    for (const c of calls) expect(pgCode(await settle(c))).toBe("42501");
    const internal = await settle(app.sql`select public.platform_assert_admin_internal(${s.admin})`);
    expect(pgCode(internal)).toBe("42501");
  });

  it("tenant list returns only whitelisted columns and filters", async () => {
    const rows = await app.sql<Record<string, unknown>[]>`
      select * from public.platform_tenant_list(${s.admin}, ${`pa-${suffix}`}, null, null)`;
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]!).sort()).toEqual(LIST_COLUMNS);
    expect(rows[0]).toMatchObject({ tenant_id: s.tenant, owner_email: `powner-${suffix}@example.test`, member_count: 1, channel_count: 1, plan: "start", status: "active" });
    const byStatus = await app.sql`select tenant_id from public.platform_tenant_list(${s.admin}, ${suffix}, 'suspended', null)`;
    expect(byStatus).toHaveLength(0);
    const members = await app.sql<Record<string, unknown>[]>`select * from public.platform_tenant_members(${s.admin}, ${s.tenant})`;
    expect(Object.keys(members[0]!).sort()).toEqual(["email", "name", "role"]);
    const channels = await app.sql<Record<string, unknown>[]>`select * from public.platform_tenant_channels(${s.admin}, ${s.tenant})`;
    expect(Object.keys(channels[0]!).sort()).toEqual(["channel_id", "created_at", "status"]);
  });

  it("status transitions are validated and audited; suspended tenants ingest nothing", async () => {
    const bad = await settle(app.sql`select * from public.platform_set_tenant_status(${s.admin}, ${s.tenant}, 'approve', null, null)`);
    expect(pgCode(bad)).toBe("55000");
    const noReason = await settle(app.sql`select * from public.platform_set_tenant_status(${s.admin}, ${s.tenant}, 'suspend', '  ', null)`);
    expect(pgCode(noReason)).toBe("22023");
    const [row] = await app.sql<{ status: string; previous_status: string; owner_email: string }[]>`
      select * from public.platform_set_tenant_status(${s.admin}, ${s.tenant}, 'suspend', 'Impago', '10.0.0.1')`;
    expect(row).toMatchObject({ status: "suspended", previous_status: "active", owner_email: `powner-${suffix}@example.test` });
    const [lt] = await app.sql<{ status: string }[]>`select status from public.list_user_tenants(${s.owner}) where tenant_id = ${s.tenant}`;
    expect(lt?.status).toBe("suspended");
    const ingest = await app.sql`
      select * from public.ingest_inbound_event('gupshup', ${`wh-${suffix}`}, ${`dk-${suffix}`}, '{}'::jsonb, true)`;
    expect(ingest).toHaveLength(0);
    await app.sql`select * from public.platform_set_tenant_status(${s.admin}, ${s.tenant}, 'reactivate', null, null)`;
    const audit = await app.sql<{ action: string; diff: { from: string; to: string } }[]>`
      select action, diff from public.platform_audit_list(${s.admin}, ${s.tenant}, 10)`;
    expect(audit.map((a) => a.action)).toEqual(["tenant.reactivate", "tenant.suspend"]);
    expect(audit[1]?.diff).toMatchObject({ from: "active", to: "suspended", reason: "Impago" });
  });

  it("platform audit is append-only even for the owner role", async () => {
    const upd = await settle(migrator.sql`update platform_audit_events set action = 'x' where tenant_id = ${s.tenant}`);
    expect(pgCode(upd)).toBe("42501");
    const del = await settle(migrator.sql`delete from platform_audit_events where tenant_id = ${s.tenant}`);
    expect(pgCode(del)).toBe("42501");
  });

  it("plan change upserts tenant_plans and is visible to the tenant immediately", async () => {
    await app.sql`select public.platform_set_tenant_plan(${s.admin}, ${s.tenant}, 'pro', ${JSON.stringify({ seats: 30 })}::jsonb, null)`;
    const plan = await withTenant(app.db, s.tenant, (tx) => tx.execute<{ plan: string }>("select plan from tenant_plans" as never));
    expect(plan[0]?.plan).toBe("pro");
    const usage = await withTenant(app.db, s.tenant, readPlanUsage);
    expect(usage.limitsOverride).toEqual({ seats: 30 });
    const other = await withTenant(app.db, s.other, readPlanUsage);
    expect(other.limitsOverride).toBeNull();
    const bad = await settle(app.sql`select public.platform_set_tenant_plan(${s.admin}, ${s.tenant}, 'gold', null, null)`);
    expect(pgCode(bad)).toBe("22023");
  });

  it("records payments, derives paid_until and totals per month", async () => {
    const [p] = await app.sql<{ id: string }[]>`
      select public.platform_record_payment(${s.admin}, ${s.other}, 4900, 'USD', '2026-01-01', '2099-01-31', 'transfer', 'TRX-1', null, null) as id`;
    expect(p?.id).toMatch(/^[0-9a-f-]{36}$/);
    const bad = await settle(app.sql`
      select public.platform_record_payment(${s.admin}, ${s.other}, 0, 'USD', '2026-01-01', '2026-01-31', 'transfer', null, null, null)`);
    expect(pgCode(bad)).toBe("22023");
    const [row] = await app.sql<{ paid_until: Date; overdue: boolean }[]>`
      select paid_until, overdue from public.platform_tenant_list(${s.admin}, ${`pb-${suffix}`}, null, null)`;
    expect(row?.overdue).toBe(false);
    const totals = await app.sql<{ currency: string; total_minor: string }[]>`select * from public.platform_payment_totals(${s.admin}, 1)`;
    expect(Number(totals.find((t) => t.currency === "USD")?.total_minor ?? 0)).toBeGreaterThanOrEqual(4900);
    const list = await app.sql<Record<string, unknown>[]>`select * from public.platform_list_payments(${s.admin}, ${s.other}, null, null)`;
    expect(list).toHaveLength(1);
  });

  it("signup starts pending_approval only while require_approval is on", async () => {
    await app.sql`select public.platform_set_require_approval(${s.admin}, true, null)`;
    let pending: { tenant_id: string; user_id: string } | undefined;
    try {
      [pending] = await app.sql<{ tenant_id: string; user_id: string }[]>`
        select * from public.signup_tenant(${`psign-${suffix}@example.test`}, 'P', 'scrypt$dummy', 'Pend', ${`psign-${suffix}`})`;
    } finally {
      await app.sql`select public.platform_set_require_approval(${s.admin}, false, null)`;
    }
    tenantIds.push(pending!.tenant_id);
    userIds.push(pending!.user_id);
    const [st] = await app.sql<{ status: string }[]>`select status from public.list_user_tenants(${pending!.user_id})`;
    expect(st?.status).toBe("pending_approval");
    const [settings] = await app.sql<{ require_approval: boolean }[]>`select * from public.platform_get_settings(${s.admin})`;
    expect(settings?.require_approval).toBe(false);
    const [approved] = await app.sql<{ status: string }[]>`
      select status from public.platform_set_tenant_status(${s.admin}, ${pending!.tenant_id}, 'approve', null, null)`;
    expect(approved?.status).toBe("active");
  });

  it("dashboard aggregates statuses and plans", async () => {
    const [d] = await app.sql<{ v: { byStatus: Record<string, number>; activeByPlan: Record<string, number>; overdue: number } }[]>`
      select public.platform_dashboard(${s.admin}) as v`;
    expect(d?.v.byStatus["active"]).toBeGreaterThanOrEqual(2);
    expect(d?.v.activeByPlan["pro"]).toBeGreaterThanOrEqual(1);
    expect(typeof d?.v.overdue).toBe("number");
  });
});
