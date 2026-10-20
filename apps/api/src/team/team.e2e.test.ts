import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { and, auditEvents, createDb, type DbHandle, eq, inArray, teamInvitations, tenants, users } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import type { MailMessage } from "@crmwsp/mailer";
import { MAILER } from "./invitation-token.js";

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

describe.skipIf(!hasDb)("team invitations and members (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const sent: MailMessage[] = [];
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mail = (l: string) => `team-${l}-${suffix}@example.test`;
  const owner = { email: mail("owner"), name: "Olga", password, tenantName: "Equipo A", tenantSlug: `team-a-${suffix}` };
  const other = { email: mail("other"), name: "Bea", password, tenantName: "Equipo B", tenantSlug: `team-b-${suffix}` };
  const s = { ownerCookie: "", otherCookie: "", agentCookie: "", tenantA: "", tenantB: "", ownerId: "", otherId: "", agentId: "" };

  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, opts: { cookie?: string; tenant?: string; payload?: unknown } = {}) =>
    app.inject({
      method,
      url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.tenant ? { "x-tenant-id": opts.tenant } : {}) },
    }) as unknown as Promise<InjectResult>;
  const asOwner = (m: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) =>
    call(m, url, { cookie: s.ownerCookie, tenant: s.tenantA, payload });
  const lastToken = (to: string): string => {
    const m = [...sent].reverse().find((x) => x.to === to);
    const token = /\/invite\/([A-Za-z0-9_-]{43})/.exec(m?.text ?? "")?.[1];
    if (!token) throw new Error(`no invitation mail for ${to}`);
    return token;
  };
  const invite = (email: string, role: string) => asOwner("POST", "/team/invitations", { email, role });

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    // Capture outgoing mail instead of sending it (the service holds this same instance).
    app.get<{ send: (m: MailMessage) => Promise<{ messageId: string }> }>(MAILER, { strict: false }).send = (m) => (sent.push(m), Promise.resolve({ messageId: "test" }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    for (const [acc, key] of [
      [owner, "owner"],
      [other, "other"],
    ] as const) {
      const res = await call("POST", "/auth/signup", { payload: acc });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { user: { id: string }; tenants: { id: string }[] };
      if (key === "owner") Object.assign(s, { ownerCookie: cookieOf(res), tenantA: body.tenants[0]!.id, ownerId: body.user.id });
      else Object.assign(s, { otherCookie: cookieOf(res), tenantB: body.tenants[0]!.id, otherId: body.user.id });
    }
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, [owner.tenantSlug, other.tenantSlug]));
      await migrator.db.delete(users).where(inArray(users.email, [owner.email, other.email, mail("agent")]));
      await migrator.close();
    }
  });

  it("invites by email, emails a one-time link and previews it publicly", async () => {
    const res = await invite(mail("agent").toUpperCase(), "agent");
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email: mail("agent"), role: "agent" });
    expect(JSON.stringify(res.json())).not.toMatch(/token/i);
    const token = lastToken(mail("agent"));
    expect(sent.at(-1)?.subject).toContain("Equipo A");
    const [row] = await migrator.db.select().from(teamInvitations).where(eq(teamInvitations.email, mail("agent")));
    expect(row?.tokenHash.length).toBe(32);
    expect(row!.tokenHash.toString("base64url")).not.toBe(token);
    const prev = await call("GET", `/invitations/${token}`);
    expect(prev.statusCode).toBe(200);
    expect(prev.json()).toMatchObject({ tenantName: "Equipo A", email: mail("agent"), role: "agent", hasAccount: false });
    expect((await invite(mail("agent"), "viewer")).statusCode).toBe(409);
  });

  it("nobody invites an owner and agents cannot invite", async () => {
    expect((await invite(mail("x"), "owner")).statusCode).toBe(400);
  });

  it("accepts by creating the account (single use) and signs in", async () => {
    const token = lastToken(mail("agent"));
    const res = await call("POST", `/invitations/${token}/accept`, { payload: { name: "Ágata", password } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: s.tenantA, role: "agent" });
    s.agentCookie = cookieOf(res);
    const me = (await call("GET", "/auth/me", { cookie: s.agentCookie })).json() as { user: { id: string; email: string }; tenants: { id: string; role: string }[] };
    expect(me.user.email).toBe(mail("agent"));
    expect(me.tenants).toEqual([expect.objectContaining({ id: s.tenantA, role: "agent" })]);
    s.agentId = me.user.id;
    expect((await call("POST", `/invitations/${token}/accept`, { payload: { name: "X", password } })).statusCode).toBe(404);
    expect((await call("GET", `/invitations/${token}`)).statusCode).toBe(404);
    const agentInvites = await call("POST", "/team/invitations", { cookie: s.agentCookie, tenant: s.tenantA, payload: { email: mail("z"), role: "viewer" } });
    expect(agentInvites.statusCode).toBe(403);
  });

  it("rejects a signed-in user whose email is not the invited one", async () => {
    expect((await invite(mail("wrong"), "viewer")).statusCode).toBe(201);
    const token = lastToken(mail("wrong"));
    const res = await call("POST", `/invitations/${token}/accept`, { cookie: s.otherCookie, payload: {} });
    expect(res.statusCode).toBe(403);
    expect((await call("GET", `/invitations/${token}`)).statusCode).toBe(200);
  });

  it("rejects expired tokens and malformed tokens", async () => {
    expect((await invite(mail("late"), "viewer")).statusCode).toBe(201);
    const token = lastToken(mail("late"));
    await migrator.db.update(teamInvitations).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(teamInvitations.email, mail("late")));
    expect((await call("GET", `/invitations/${token}`)).statusCode).toBe(404);
    expect((await call("POST", `/invitations/${token}/accept`, { payload: { name: "L", password } })).statusCode).toBe(404);
    expect((await call("GET", "/invitations/not-a-token")).statusCode).toBe(400);
  });

  it("an existing user accepts while signed in; without session gets 401 to log in", async () => {
    expect((await invite(other.email, "viewer")).statusCode).toBe(201);
    const token = lastToken(other.email);
    expect((await call("GET", `/invitations/${token}`)).json()).toMatchObject({ hasAccount: true });
    expect((await call("POST", `/invitations/${token}/accept`, { payload: {} })).statusCode).toBe(401);
    expect((await call("POST", `/invitations/${token}/accept`, { payload: { name: "B", password } })).statusCode).toBe(401);
    const res = await call("POST", `/invitations/${token}/accept`, { cookie: s.otherCookie, payload: {} });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ tenantId: s.tenantA, role: "viewer" });
  });

  it("admins cannot touch owners nor grant admin; last owner is protected", async () => {
    expect((await asOwner("PATCH", `/team/members/${s.otherId}`, { role: "admin" })).statusCode).toBe(204);
    const asAdmin = (m: "PATCH" | "DELETE" | "POST", url: string, payload?: unknown) => call(m, url, { cookie: s.otherCookie, tenant: s.tenantA, payload });
    expect((await asAdmin("PATCH", `/team/members/${s.ownerId}`, { role: "agent" })).statusCode).toBe(403);
    expect((await asAdmin("DELETE", `/team/members/${s.ownerId}`)).statusCode).toBe(403);
    expect((await asAdmin("PATCH", `/team/members/${s.agentId}`, { role: "admin" })).statusCode).toBe(403);
    expect((await asAdmin("POST", "/team/invitations", { email: mail("adm"), role: "admin" })).statusCode).toBe(403);
    expect((await asAdmin("PATCH", `/team/members/${s.agentId}`, { role: "viewer" })).statusCode).toBe(204);
    const demote = await asOwner("PATCH", `/team/members/${s.ownerId}`, { role: "admin" });
    expect(demote.statusCode).toBe(403);
    expect(demote.json()).toMatchObject({ code: "FORBIDDEN" });
    expect((await asOwner("DELETE", `/team/members/${s.ownerId}`)).statusCode).toBe(403);
  });

  it("is tenant-isolated: tenant B cannot see or manage tenant A's team", async () => {
    const [inv] = await migrator.db.select({ id: teamInvitations.id }).from(teamInvitations).where(eq(teamInvitations.email, mail("wrong")));
    const asB = (m: "GET" | "DELETE" | "PATCH" | "POST", url: string, payload?: unknown) => call(m, url, { cookie: s.otherCookie, tenant: s.tenantB, payload });
    expect(((await asB("GET", "/team/invitations")).json() as { items: unknown[] }).items).toEqual([]);
    expect((await asB("DELETE", `/team/invitations/${inv!.id}`)).statusCode).toBe(404);
    expect((await asB("POST", `/team/invitations/${inv!.id}/resend`)).statusCode).toBe(404);
    expect((await asB("PATCH", `/team/members/${s.agentId}`, { role: "agent" })).statusCode).toBe(404);
    expect((await asB("DELETE", `/team/members/${s.agentId}`)).statusCode).toBe(404);
    // Owner A with tenant B's header is not a member there.
    expect((await call("GET", "/team/invitations", { cookie: s.ownerCookie, tenant: s.tenantB })).statusCode).toBe(403);
  });

  it("resend rotates the token; revoke kills it", async () => {
    const [inv] = await migrator.db.select({ id: teamInvitations.id }).from(teamInvitations).where(eq(teamInvitations.email, mail("wrong")));
    const before = lastToken(mail("wrong"));
    expect((await asOwner("POST", `/team/invitations/${inv!.id}/resend`)).statusCode).toBe(200);
    const after = lastToken(mail("wrong"));
    expect(after).not.toBe(before);
    expect((await call("GET", `/invitations/${before}`)).statusCode).toBe(404);
    expect((await call("GET", `/invitations/${after}`)).statusCode).toBe(200);
    expect((await asOwner("DELETE", `/team/invitations/${inv!.id}`)).statusCode).toBe(204);
    expect((await call("GET", `/invitations/${after}`)).statusCode).toBe(404);
    const list = (await asOwner("GET", "/team/invitations")).json() as { items: { id: string }[] };
    expect(list.items.map((i) => i.id)).not.toContain(inv!.id);
  });

  it("enforces the plan seat limit counting pending invitations (402)", async () => {
    let status = 0;
    for (let i = 0; i < 10 && status !== 402; i++) status = (await invite(mail(`seat${i}`), "viewer")).statusCode;
    expect(status).toBe(402);
    const res = await invite(mail("seat-extra"), "viewer");
    expect(res.json()).toMatchObject({ code: "PLAN_LIMIT_EXCEEDED" });
  });

  it("removing a member ends their access and revokes sessions when no tenant is left", async () => {
    expect((await asOwner("DELETE", `/team/members/${s.agentId}`)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", { cookie: s.agentCookie })).statusCode).toBe(401);
    // Bea still belongs to her own tenant: her session survives, tenant A access does not.
    expect((await asOwner("DELETE", `/team/members/${s.otherId}`)).statusCode).toBe(204);
    expect((await call("GET", "/auth/me", { cookie: s.otherCookie })).statusCode).toBe(200);
    expect((await call("GET", "/team/invitations", { cookie: s.otherCookie, tenant: s.tenantA })).statusCode).toBe(403);
  });

  it("audits every action", async () => {
    const rows = await migrator.db.select({ action: auditEvents.action }).from(auditEvents).where(and(eq(auditEvents.tenantId, s.tenantA)));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["team_invitation.created", "team_invitation.accepted", "team_invitation.resent", "team_invitation.revoked", "membership.role_changed", "membership.removed"]) {
      expect(actions).toContain(a);
    }
  });
});
