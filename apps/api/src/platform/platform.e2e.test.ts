import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDb, type DbHandle, inArray, tenants, users } from "@crmwsp/db";
import type { MailMessage } from "@crmwsp/mailer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { PLATFORM_MAILER } from "./platform.service.js";

const APP_URL = process.env["DATABASE_URL"];
const MIGRATOR_URL = process.env["DATABASE_URL_MIGRATOR"];
const hasDb = Boolean(APP_URL && MIGRATOR_URL);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}

const cookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  const pair = ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
  if (!pair.startsWith("__Host-crmwsp_session=") || pair.endsWith("=")) throw new Error("no session cookie");
  return pair;
};

describe.skipIf(!hasDb)("platform backoffice (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const sent: MailMessage[] = [];
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mail = (l: string) => `plat-${l}-${suffix}@example.test`;
  const admin = { email: mail("admin"), name: "Ana", password, tenantName: "SaaS Owner", tenantSlug: `plat-own-${suffix}` };
  const client = { email: mail("client"), name: "Carla", password, tenantName: `Cliente ${suffix}`, tenantSlug: `plat-cli-${suffix}` };
  const late = { email: mail("late"), name: "Lalo", password, tenantName: `Nuevo ${suffix}`, tenantSlug: `plat-new-${suffix}` };
  const s = { adminCookie: "", clientCookie: "", lateCookie: "", adminId: "", clientTenant: "", lateTenant: "" };

  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, opts: { cookie?: string; tenant?: string; payload?: unknown } = {}) =>
    app.inject({
      method,
      url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.tenant ? { "x-tenant-id": opts.tenant } : {}) },
    }) as unknown as Promise<InjectResult>;
  const asAdmin = (m: "GET" | "POST" | "PATCH" | "PUT", url: string, payload?: unknown) => call(m, url, { cookie: s.adminCookie, payload });
  const signup = async (acc: typeof admin) => {
    const res = await call("POST", "/auth/signup", { payload: acc });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { id: string }; tenants: { id: string; status?: string }[] };
    return { cookie: cookieOf(res), userId: body.user.id, tenant: body.tenants[0]!.id, status: body.tenants[0]!.status };
  };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    app.get<{ send: (m: MailMessage) => Promise<{ messageId: string }> }>(PLATFORM_MAILER, { strict: false }).send = (m) => (
      sent.push(m), Promise.resolve({ messageId: "test" })
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const a = await signup(admin);
    Object.assign(s, { adminCookie: a.cookie, adminId: a.userId });
    const c = await signup(client);
    expect(c.status).toBe("active");
    Object.assign(s, { clientCookie: c.cookie, clientTenant: c.tenant });
  });

  afterAll(async () => {
    if (migrator) {
      await migrator.sql`update platform_settings set require_approval = false where id = 1`;
      await migrator.db.delete(tenants).where(inArray(tenants.slug, [admin.tenantSlug, client.tenantSlug, late.tenantSlug]));
      await migrator.db.delete(users).where(inArray(users.email, [admin.email, client.email, late.email]));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("hides the panel from tenant users with 404 (not 403)", async () => {
    expect((await call("GET", "/platform/me", { cookie: s.clientCookie })).json()).toEqual({ isPlatformAdmin: false });
    for (const [m, url] of [
      ["GET", "/platform/dashboard"],
      ["GET", "/platform/tenants"],
      ["GET", `/platform/tenants/${s.clientTenant}`],
      ["POST", `/platform/tenants/${s.clientTenant}/status`],
      ["PUT", `/platform/tenants/${s.clientTenant}/plan`],
      ["GET", "/platform/payments"],
      ["POST", "/platform/payments"],
      ["PATCH", "/platform/settings"],
      ["GET", "/platform/users"],
      ["GET", `/platform/users/${s.adminId}`],
      ["POST", `/platform/users/${s.adminId}/revoke-sessions`],
      ["GET", "/platform/channels"],
      ["GET", "/platform/plans"],
      ["GET", "/platform/usage"],
      ["GET", "/platform/audit"],
    ] as const) {
      const res = await call(m, url, { cookie: s.clientCookie, payload: {} });
      expect(res.statusCode, `${m} ${url}`).toBe(404);
    }
    expect((await call("GET", "/platform/tenants")).statusCode).toBe(401);
  });

  it("lets a CLI-granted admin list tenants with whitelisted fields only", async () => {
    await migrator.sql`insert into platform_admins (user_id) values (${s.adminId})`;
    expect((await asAdmin("GET", "/platform/me")).json()).toEqual({ isPlatformAdmin: true });
    const list = await asAdmin("GET", `/platform/tenants?q=${encodeURIComponent(client.tenantSlug)}`);
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: s.clientTenant, ownerEmail: client.email, status: "active", plan: "start", memberCount: 1 });
    const detail = await asAdmin("GET", `/platform/tenants/${s.clientTenant}`);
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as { members: Record<string, unknown>[] };
    expect(Object.keys(body).sort()).toEqual(["audit", "channels", "members", "payments", "tenant"]);
    expect(Object.keys(body.members[0]!).sort()).toEqual(["email", "name", "role"]);
    expect(JSON.stringify(body)).not.toMatch(/password|token|credential/i);
    expect((await asAdmin("GET", `/platform/tenants/${randomUUID()}`)).statusCode).toBe(404);
  });

  it("suspends with a reason (mail + audit), blocks the tenant API, then reactivates", async () => {
    expect((await asAdmin("POST", `/platform/tenants/${s.clientTenant}/status`, { action: "suspend" })).statusCode).toBe(400);
    const res = await asAdmin("POST", `/platform/tenants/${s.clientTenant}/status`, { action: "suspend", reason: "Impago" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "suspended", statusReason: "Impago" });
    expect(sent.at(-1)).toMatchObject({ to: client.email });
    expect(sent.at(-1)?.text).toContain("Impago");
    const me = (await call("GET", "/auth/me", { cookie: s.clientCookie })).json() as { tenants: { status: string }[] };
    expect(me.tenants[0]?.status).toBe("suspended");
    const blocked = await call("GET", "/team/invitations", { cookie: s.clientCookie, tenant: s.clientTenant });
    expect(blocked.statusCode).toBe(403);
    expect((await asAdmin("POST", `/platform/tenants/${s.clientTenant}/status`, { action: "approve" })).statusCode).toBe(409);
    expect((await asAdmin("POST", `/platform/tenants/${s.clientTenant}/status`, { action: "reactivate" })).statusCode).toBe(200);
    expect((await call("GET", "/team/invitations", { cookie: s.clientCookie, tenant: s.clientTenant })).statusCode).toBe(200);
    const detail = (await asAdmin("GET", `/platform/tenants/${s.clientTenant}`)).json() as { audit: { action: string; actorEmail: string }[] };
    expect(detail.audit.map((a) => a.action)).toEqual(["tenant.reactivate", "tenant.suspend"]);
    expect(detail.audit[0]?.actorEmail).toBe(admin.email);
  });

  it("changes the plan immediately (the tenant sees it) and records payments", async () => {
    const res = await asAdmin("PUT", `/platform/tenants/${s.clientTenant}/plan`, { plan: "pro", limitsOverride: { seats: 40 } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ plan: "pro", limitsOverride: { seats: 40 } });
    const billing = await call("GET", "/billing/plan", { cookie: s.clientCookie, tenant: s.clientTenant });
    expect(billing.statusCode).toBe(200);
    const bp = billing.json() as { plan: { id: string }; usage: { key: string; limit: number | null }[] };
    expect(bp.plan.id).toBe("pro");
    expect(bp.usage.find((u) => u.key === "seats")?.limit).toBe(40);
    expect(bp.usage.find((u) => u.key === "contacts")?.limit).toBe(30_000);
    const pay = await asAdmin("POST", "/platform/payments", {
      tenantId: s.clientTenant,
      amountMinor: 8900,
      currency: "USD",
      periodStart: "2026-10-01",
      periodEnd: "2099-10-31",
      method: "transfer",
      reference: "TRX-77",
    });
    expect(pay.statusCode).toBe(201);
    expect(pay.json()).toMatchObject({ amountMinor: 8900, periodEnd: "2099-10-31", recordedByEmail: admin.email });
    const list = (await asAdmin("GET", `/platform/payments?tenantId=${s.clientTenant}`)).json() as { items: unknown[]; totals: unknown[] };
    expect(list.items).toHaveLength(1);
    expect(list.totals.length).toBeGreaterThan(0);
    const t = (await asAdmin("GET", `/platform/tenants?q=${client.tenantSlug}`)).json() as { items: { paidUntil: string; overdue: boolean }[] };
    expect(t.items[0]).toMatchObject({ paidUntil: "2099-10-31", overdue: false });
    const dash = await asAdmin("GET", "/platform/dashboard");
    expect(dash.statusCode).toBe(200);
    expect((dash.json() as { mrrEstimateUsd: number }).mrrEstimateUsd).toBeGreaterThanOrEqual(89);
  });

  it("with requireApproval on, new signups wait for approval and get an email when approved", async () => {
    expect((await asAdmin("PATCH", "/platform/settings", { requireApproval: true })).json()).toMatchObject({ requireApproval: true });
    let l: Awaited<ReturnType<typeof signup>>;
    try {
      l = await signup(late);
    } finally {
      await asAdmin("PATCH", "/platform/settings", { requireApproval: false });
    }
    expect(l.status).toBe("pending_approval");
    expect((await call("GET", "/team/invitations", { cookie: l.cookie, tenant: l.tenant })).statusCode).toBe(403);
    const queue = (await asAdmin("GET", "/platform/tenants?status=pending_approval")).json() as { items: { id: string }[] };
    expect(queue.items.map((i) => i.id)).toContain(l.tenant);
    expect((await asAdmin("POST", `/platform/tenants/${l.tenant}/status`, { action: "approve" })).statusCode).toBe(200);
    expect(sent.at(-1)).toMatchObject({ to: late.email });
    expect((await call("GET", "/team/invitations", { cookie: l.cookie, tenant: l.tenant })).statusCode).toBe(200);
  });

  it("backoffice sections: users, channels, plans, usage and audit (whitelisted fields)", async () => {
    const users = await asAdmin("GET", `/platform/users?q=${encodeURIComponent(client.email)}`);
    expect(users.statusCode).toBe(200);
    const items = (users.json() as { items: Record<string, unknown>[] }).items;
    expect(items).toHaveLength(1);
    expect(Object.keys(items[0]!).sort()).toEqual(["activeSessions", "createdAt", "email", "id", "isPlatformAdmin", "lastLoginAt", "name", "tenants"]);
    expect(items[0]).toMatchObject({ email: client.email, isPlatformAdmin: false, tenants: [{ tenantId: s.clientTenant, role: "owner" }] });
    expect(JSON.stringify(items)).not.toMatch(/password|token|hash/i);
    const clientId = items[0]!["id"] as string;
    expect((await asAdmin("GET", `/platform/users/${clientId}`)).statusCode).toBe(200);
    expect((await asAdmin("GET", `/platform/users/${randomUUID()}`)).statusCode).toBe(404);

    const channels = await asAdmin("GET", "/platform/channels?status=active");
    expect(channels.statusCode).toBe(200);
    expect(JSON.stringify(channels.json())).not.toMatch(/webhook|credential|externalApp/i);
    expect((await asAdmin("GET", "/platform/channels?status=bogus")).statusCode).toBe(400);

    const plans = (await asAdmin("GET", "/platform/plans")).json() as { plans: { id: string; priceMonthlyUsd: number }[]; overrides: { tenantId: string }[] };
    expect(plans.plans.map((p) => p.id)).toEqual(["start", "pro"]);
    expect(plans.overrides.map((o) => o.tenantId)).toContain(s.clientTenant);

    const usage = await asAdmin("GET", "/platform/usage?month=2026-10");
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ month: "2026-10", totals: { aiCostUsd: expect.any(Number) } });
    expect((await asAdmin("GET", "/platform/usage?month=2026-13")).statusCode).toBe(400);

    const audit = (await asAdmin("GET", `/platform/audit?tenantId=${s.clientTenant}&action=tenant.`)).json() as { items: { action: string; tenantName: string }[]; total: number; pageSize: number };
    expect(audit.total).toBeGreaterThanOrEqual(3);
    expect(audit.items[0]?.tenantName).toBe(client.tenantName);

    const revoke = await asAdmin("POST", `/platform/users/${clientId}/revoke-sessions`);
    expect(revoke.statusCode).toBe(200);
    expect((revoke.json() as { revoked: number }).revoked).toBeGreaterThanOrEqual(1);
    expect((await call("GET", "/auth/me", { cookie: s.clientCookie })).statusCode).toBe(401);
    const logged = (await asAdmin("GET", "/platform/audit?action=user.sessions_revoked")).json() as { items: { diff: { userId: string } }[] };
    expect(logged.items[0]?.diff.userId).toBe(clientId);
  });

  it("revoking the admin row takes effect on the next request", async () => {
    await migrator.sql`delete from platform_admins where user_id = ${s.adminId}`;
    expect((await asAdmin("GET", "/platform/dashboard")).statusCode).toBe(404);
  });
});
