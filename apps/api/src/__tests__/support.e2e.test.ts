import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { createDb, type DbHandle, inArray, tenants, users } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { RealtimeHub } from "../events/realtime.hub.js";

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

describe.skipIf(!hasDb)("support tickets (e2e)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const published: { channel: string; ticketId: string }[] = [];
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const acc = (l: string) => ({ email: `sup-${l}-${suffix}@example.test`, name: l, password, tenantName: `Sup ${l} ${suffix}`, tenantSlug: `sup-${l}-${suffix}` });
  const admin = acc("admin");
  const owner = acc("owner");
  const other = acc("other");
  const s = { admin: "", adminId: "", owner: "", ownerTenant: "", other: "", otherTenant: "", ticket: "" };

  const call = (method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, opts: { cookie?: string; tenant?: string; payload?: unknown } = {}) =>
    app.inject({
      method,
      url,
      ...(opts.payload !== undefined ? { payload: opts.payload as object } : {}),
      headers: { ...(opts.cookie ? { cookie: opts.cookie } : {}), ...(opts.tenant ? { "x-tenant-id": opts.tenant } : {}) },
    }) as unknown as Promise<InjectResult>;
  const signup = async (a: ReturnType<typeof acc>) => {
    const res = await call("POST", "/auth/signup", { payload: a });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { id: string }; tenants: { id: string }[] };
    return { cookie: cookieOf(res), userId: body.user.id, tenant: body.tenants[0]!.id };
  };

  beforeAll(async () => {
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    const hub = app.get(RealtimeHub);
    hub.publish = async (tenantId, e) => void published.push({ channel: tenantId, ticketId: (e as { ticketId?: string }).ticketId ?? "" });
    hub.publishPlatformSupport = async (e) => void published.push({ channel: "platform", ticketId: e.ticketId });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const a = await signup(admin);
    Object.assign(s, { admin: a.cookie, adminId: a.userId });
    const o = await signup(owner);
    Object.assign(s, { owner: o.cookie, ownerTenant: o.tenant });
    const x = await signup(other);
    Object.assign(s, { other: x.cookie, otherTenant: x.tenant });
    await migrator.sql`insert into platform_admins (user_id) values (${s.adminId})`;
  });

  afterAll(async () => {
    if (migrator) {
      await migrator.sql`delete from platform_admins where user_id = ${s.adminId}`;
      await migrator.db.delete(tenants).where(inArray(tenants.slug, [admin.tenantSlug, owner.tenantSlug, other.tenantSlug]));
      await migrator.db.delete(users).where(inArray(users.email, [admin.email, owner.email, other.email]));
      await migrator.close();
    }
    if (app) await app.close();
  });

  it("a member opens a ticket and the platform inbox is notified", async () => {
    const res = await call("POST", "/support/tickets", {
      cookie: s.owner,
      tenant: s.ownerTenant,
      payload: { subject: "No llegan mensajes", category: "whatsapp", priority: "high", message: "Desde ayer no entra nada" },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { ticket: { id: string; status: string; createdBy: { email: string } }; messages: unknown[] };
    expect(body.ticket.status).toBe("open");
    expect(body.ticket.createdBy.email).toBe(owner.email);
    expect(body.messages).toHaveLength(1);
    s.ticket = body.ticket.id;
    expect(published).toContainEqual({ channel: "platform", ticketId: s.ticket });
  });

  it("another tenant cannot see or reply to the ticket", async () => {
    const list = (await call("GET", "/support/tickets", { cookie: s.other, tenant: s.otherTenant })).json() as { items: unknown[] };
    expect(list.items).toHaveLength(0);
    expect((await call("GET", `/support/tickets/${s.ticket}`, { cookie: s.other, tenant: s.otherTenant })).statusCode).toBe(404);
    expect((await call("POST", `/support/tickets/${s.ticket}/messages`, { cookie: s.other, tenant: s.otherTenant, payload: { body: "x" } })).statusCode).toBe(404);
  });

  it("non-admins get 404 on the backoffice support routes", async () => {
    for (const [m, url] of [
      ["GET", "/platform/support/tickets"],
      ["GET", `/platform/support/tickets/${s.ticket}`],
      ["POST", `/platform/support/tickets/${s.ticket}/messages`],
      ["PATCH", `/platform/support/tickets/${s.ticket}`],
      ["GET", "/platform/support/canned"],
      ["GET", "/platform/support/events"],
    ] as const) {
      expect((await call(m, url, { cookie: s.owner, payload: {} })).statusCode, `${m} ${url}`).toBe(404);
    }
  });

  it("the admin replies in real time, internal notes stay hidden and the tenant sees it unread", async () => {
    const list = (await call("GET", "/platform/support/tickets?status=open", { cookie: s.admin })).json() as { items: { id: string; tenant: { id: string } }[] };
    expect(list.items.find((t) => t.id === s.ticket)?.tenant.id).toBe(s.ownerTenant);

    published.length = 0;
    const r = await call("POST", `/platform/support/tickets/${s.ticket}/messages`, { cookie: s.admin, payload: { body: "Lo estamos revisando" } });
    expect(r.statusCode).toBe(201);
    expect(published).toContainEqual({ channel: s.ownerTenant, ticketId: s.ticket });
    await call("POST", `/platform/support/tickets/${s.ticket}/messages`, { cookie: s.admin, payload: { body: "nota secreta", internal: true } });

    const unread = (await call("GET", "/support/unread-count", { cookie: s.owner, tenant: s.ownerTenant })).json() as { unreadCount: number };
    expect(unread.unreadCount).toBe(1);
    const thread = (await call("GET", `/support/tickets/${s.ticket}`, { cookie: s.owner, tenant: s.ownerTenant })).json() as {
      ticket: { status: string };
      messages: { body: string; authorType: string; authorName: string | null }[];
    };
    expect(thread.ticket.status).toBe("waiting_customer");
    expect(thread.messages.map((m) => m.body)).toEqual(["Desde ayer no entra nada", "Lo estamos revisando"]);
    expect(thread.messages[1]).toMatchObject({ authorType: "platform_admin", authorName: null });
    const after = (await call("GET", "/support/unread-count", { cookie: s.owner, tenant: s.ownerTenant })).json() as { unreadCount: number };
    expect(after.unreadCount).toBe(0);
  });

  it("a tenant reply reopens the ticket; the admin assigns and resolves it; the tenant cannot close twice", async () => {
    const r = (await call("POST", `/support/tickets/${s.ticket}/messages`, { cookie: s.owner, tenant: s.ownerTenant, payload: { body: "Gracias" } })).json() as {
      ticket: { status: string };
    };
    expect(r.ticket.status).toBe("open");
    const up = await call("PATCH", `/platform/support/tickets/${s.ticket}`, { cookie: s.admin, payload: { assignToMe: true, status: "resolved" } });
    expect(up.statusCode).toBe(200);
    expect(up.json()).toMatchObject({ status: "resolved", assignee: { id: s.adminId } });
    expect((await call("POST", `/support/tickets/${s.ticket}/close`, { cookie: s.owner, tenant: s.ownerTenant })).statusCode).toBe(409);
  });

  it("manages canned responses", async () => {
    const c = await call("POST", "/platform/support/canned", { cookie: s.admin, payload: { title: `Saludo ${suffix}`, body: "Hola {{nombre}}" } });
    expect(c.statusCode).toBe(201);
    const id = (c.json() as { id: string }).id;
    expect((await call("PUT", `/platform/support/canned/${id}`, { cookie: s.admin, payload: { title: `Saludo ${suffix}`, body: "Hola {{nombre}}!" } })).statusCode).toBe(200);
    expect((await call("DELETE", `/platform/support/canned/${id}`, { cookie: s.admin })).statusCode).toBe(204);
    expect((await call("DELETE", `/platform/support/canned/${id}`, { cookie: s.admin })).statusCode).toBe(404);
  });

  it("rate-limits ticket creation per user", async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await call("POST", "/support/tickets", { cookie: s.other, tenant: s.otherTenant, payload: { subject: `Prueba ${i}`, category: "other", message: "x" } })).statusCode;
    }
    expect(last).toBe(429);
  });
});
