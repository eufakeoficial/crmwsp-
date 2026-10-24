import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  availableSlotsResponseSchema,
  bookingListSchema,
  bookingResourceSchema,
  bookingSchema,
  bookingServiceSchema,
  errorResponseSchema,
} from "@crmwsp/contracts";
import { auditEvents, contacts, createDb, eq, inArray, memberships, tenantPlans, tenants, users, and, type DbHandle } from "@crmwsp/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";

const hasEnv = Boolean(process.env["DATABASE_URL"] && process.env["DATABASE_URL_MIGRATOR"] && process.env["REDIS_URL"]);

interface InjectResult {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json: () => unknown;
}
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const sessionCookieOf = (res: InjectResult): string => {
  const raw = res.headers["set-cookie"];
  return ((Array.isArray(raw) ? raw[0] : String(raw ?? "")) ?? "").split(";")[0] ?? "";
};

/** Next Monday (UTC date) at least 7 days ahead, as YYYY-MM-DD. */
function nextMonday(): string {
  const d = new Date(Date.now() + 7 * 24 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7));
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasEnv)("bookings (e2e, real Postgres)", () => {
  let app: NestFastifyApplication;
  let migrator: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  const password = "correct-horse-battery";
  const mk = (k: string) => ({ email: `book-${k}-${suffix}@example.test`, name: k.toUpperCase(), password, tenantName: `Book ${k}`, tenantSlug: `book-${k}-${suffix}` });
  const accounts = { a: mk("a"), b: mk("b"), c: mk("c") };
  const s = {} as { cookieA: string; cookieB: string; cookieC: string; tenantA: string; tenantB: string; contactA: string; resource: string; service: string; booking: string };
  const day = nextMonday();
  const at = (hhmm: string) => `${day}T${hhmm}:00-05:00`; // America/Lima

  const inject = (o: { method: Method; url: string; payload?: unknown; cookie: string; tenant: string }) =>
    app.inject({
      method: o.method,
      url: o.url,
      ...(o.payload !== undefined ? { payload: o.payload as object } : {}),
      headers: { cookie: o.cookie, "x-tenant-id": o.tenant },
    }) as unknown as Promise<InjectResult>;
  const asA = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieA, tenant: s.tenantA });
  const asB = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieB, tenant: s.tenantB });
  const asAgent = (method: Method, url: string, payload?: unknown) => inject({ method, url, payload, cookie: s.cookieC, tenant: s.tenantA });
  const expectError = (res: InjectResult, status: number) => {
    expect(res.statusCode).toBe(status);
    errorResponseSchema.parse(res.json());
  };

  async function signup(acc: ReturnType<typeof mk>) {
    const res = (await app.inject({ method: "POST", url: "/auth/signup", payload: acc })) as unknown as InjectResult;
    expect(res.statusCode).toBe(201);
    return { cookie: sessionCookieOf(res), tenant: (res.json() as { tenants: { id: string }[] }).tenants[0]!.id };
  }
  const userId = async (email: string) => (await migrator.db.select({ id: users.id }).from(users).where(eq(users.email, email)))[0]!.id;

  beforeAll(async () => {
    migrator = createDb(process.env["DATABASE_URL_MIGRATOR"] as string, { max: 2 });
    app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    const a = await signup(accounts.a);
    const b = await signup(accounts.b);
    const c = await signup(accounts.c);
    Object.assign(s, { cookieA: a.cookie, tenantA: a.tenant, cookieB: b.cookie, tenantB: b.tenant, cookieC: c.cookie });
    // Signup leaves a new tenant in setup (ADR 0015); grandfather the test tenants so writes are not
    // answered with SETUP_REQUIRED.
    await migrator.db.update(tenantPlans).set({ setupEndsAt: null }).where(inArray(tenantPlans.tenantId, [s.tenantA, s.tenantB, c.tenant]));
    await migrator.db.insert(memberships).values({ tenantId: s.tenantA, userId: await userId(accounts.c.email), role: "agent" });
    const [contact] = await migrator.db.insert(contacts).values({ tenantId: s.tenantA, phoneE164: "+51922222222", name: "Paciente" }).returning({ id: contacts.id });
    s.contactA = contact!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    if (migrator) {
      await migrator.db.delete(tenants).where(inArray(tenants.slug, Object.values(accounts).map((x) => x.tenantSlug)));
      await migrator.db.delete(users).where(inArray(users.email, Object.values(accounts).map((x) => x.email)));
      await migrator.close();
    }
  });

  it("owner configures resources, services and weekly hours; agents cannot", async () => {
    const r = await asA("POST", "/booking-resources", { name: "Dra. Pérez", timezone: "America/Lima" });
    expect(r.statusCode).toBe(201);
    s.resource = bookingResourceSchema.parse(r.json()).id;
    const sv = await asA("POST", "/booking-services", { name: "Limpieza dental", durationMinutes: 30, bufferMinutes: 10 });
    expect(sv.statusCode).toBe(201);
    s.service = bookingServiceSchema.parse(sv.json()).id;
    const put = await asA("PUT", `/booking-resources/${s.resource}/availability`, { windows: [{ weekday: 1, startTime: "09:00", endTime: "12:00" }] });
    expect(put.statusCode).toBe(200);
    expectError(await asAgent("POST", "/booking-services", { name: "X", durationMinutes: 30 }), 403);
    expectError(await asA("PUT", `/booking-resources/${s.resource}/availability`, { windows: [{ weekday: 1, startTime: "09:00", endTime: "10:00" }, { weekday: 1, startTime: "09:30", endTime: "11:00" }] }), 400);
  });

  it("lists available slots in the resource timezone", async () => {
    const res = await asA("GET", `/bookings/availability?serviceId=${s.service}&from=${encodeURIComponent(at("00:00"))}&to=${encodeURIComponent(at("23:59"))}&stepMinutes=30`);
    expect(res.statusCode).toBe(200);
    const body = availableSlotsResponseSchema.parse(res.json());
    expect(body.slots[0]?.startsAt).toBe(new Date(at("09:00")).toISOString());
    expect(body.slots.at(-1)?.startsAt).toBe(new Date(at("11:30")).toISOString());
  });

  it("agent books a slot; overlaps (buffer included) and outside-hours are rejected", async () => {
    const ok = await asAgent("POST", "/bookings", { resourceId: s.resource, serviceId: s.service, contactId: s.contactA, startsAt: at("09:00") });
    expect(ok.statusCode).toBe(201);
    const b = bookingSchema.parse(ok.json());
    expect(b.endsAt).toBe(new Date(at("09:30")).toISOString());
    s.booking = b.id;
    expectError(await asA("POST", "/bookings", { resourceId: s.resource, serviceId: s.service, contactId: s.contactA, startsAt: at("09:35") }), 409);
    expectError(await asA("POST", "/bookings", { resourceId: s.resource, serviceId: s.service, contactId: s.contactA, startsAt: at("11:45") }), 400);
    const slots = availableSlotsResponseSchema.parse((await asA("GET", `/bookings/availability?serviceId=${s.service}&from=${encodeURIComponent(at("00:00"))}&to=${encodeURIComponent(at("23:59"))}&stepMinutes=30`)).json()).slots;
    expect(slots.map((x) => x.startsAt)).not.toContain(new Date(at("09:00")).toISOString());
    const audit = await migrator.db.select().from(auditEvents).where(and(eq(auditEvents.tenantId, s.tenantA), eq(auditEvents.action, "booking.created")));
    expect(audit).toHaveLength(1);
  });

  it("reschedule and transitions use optimistic concurrency", async () => {
    const r = await asAgent("POST", `/bookings/${s.booking}/reschedule`, { startsAt: at("10:00"), lockVersion: 0 });
    expect(r.statusCode).toBe(200);
    expect(bookingSchema.parse(r.json()).lockVersion).toBe(1);
    expectError(await asAgent("POST", `/bookings/${s.booking}/confirm`, { lockVersion: 0 }), 409);
    const c = await asAgent("POST", `/bookings/${s.booking}/confirm`, { lockVersion: 1 });
    expect(bookingSchema.parse(c.json()).status).toBe("confirmed");
    expectError(await asAgent("POST", `/bookings/${s.booking}/complete`, { lockVersion: 2 }), 400); // not started yet
    const x = await asAgent("POST", `/bookings/${s.booking}/cancel`, { lockVersion: 2, reason: "Paciente avisó" });
    expect(bookingSchema.parse(x.json()).status).toBe("cancelled");
    expectError(await asAgent("POST", `/bookings/${s.booking}/confirm`, { lockVersion: 3 }), 400);
    expectError(await asAgent("POST", `/bookings/${s.booking}/bogus`, { lockVersion: 3 }), 404);
  });

  it("lists bookings by range and isolates tenants", async () => {
    const list = bookingListSchema.parse((await asA("GET", `/bookings?from=${encodeURIComponent(at("00:00"))}&to=${encodeURIComponent(at("23:59"))}`)).json());
    expect(list.items.map((b) => b.id)).toContain(s.booking);
    const other = bookingListSchema.parse((await asB("GET", `/bookings?from=${encodeURIComponent(at("00:00"))}&to=${encodeURIComponent(at("23:59"))}`)).json());
    expect(other.items).toHaveLength(0);
    expectError(await asB("GET", `/bookings/${s.booking}`), 404);
    expectError(await asB("GET", `/booking-resources/${s.resource}/availability`), 404);
    expectError(await asB("POST", "/bookings", { resourceId: s.resource, serviceId: s.service, contactId: s.contactA, startsAt: at("11:00") }), 404);
  });

  it("refuses to delete a resource with bookings", async () => {
    expectError(await asA("DELETE", `/booking-resources/${s.resource}`), 409);
  });
});
