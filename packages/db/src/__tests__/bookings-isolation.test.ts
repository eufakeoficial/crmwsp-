import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../client.js";
import { runMigrations } from "../migrate.js";
import { bookingAvailability, bookingResources, bookingServices, bookings, bookingTimeOff, contacts, tenants } from "../schema/index.js";
import { dangerouslyWithoutTenant, withTenant } from "../with-tenant.js";

const MIGRATOR_URL = process.env.DATABASE_URL_MIGRATOR;
const APP_URL = process.env.DATABASE_URL;
const hasDb = Boolean(MIGRATOR_URL && APP_URL);

const settle = <T>(p: Promise<T>): Promise<unknown> =>
  p.then(
    () => undefined,
    (err: unknown) => err,
  );

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error("seed failed");
  return v;
}

interface Seed {
  tenant: string;
  contact: string;
  resource: string;
  service: string;
  availability: string;
  timeOff: string;
  booking: string;
}

describe.skipIf(!hasDb)("bookings RLS with the app role", () => {
  let migrator: DbHandle;
  let app: DbHandle;
  const suffix = randomUUID().slice(0, 8);
  let A: Seed;
  let B: Seed;

  async function seed(label: string): Promise<Seed> {
    return dangerouslyWithoutTenant(migrator.db, async (tx) => {
      const t = must((await tx.insert(tenants).values({ slug: `booking-${label}-${suffix}`, name: `Tenant ${label}` }).returning({ id: tenants.id }))[0]).id;
      const contact = must((await tx.insert(contacts).values({ tenantId: t, phoneE164: "+51911111111", name: "Paciente" }).returning({ id: contacts.id }))[0]).id;
      const resource = must((await tx.insert(bookingResources).values({ tenantId: t, name: "Dra. Pérez" }).returning({ id: bookingResources.id }))[0]).id;
      const service = must(
        (await tx.insert(bookingServices).values({ tenantId: t, name: "Limpieza", durationMinutes: 30, bufferMinutes: 10 }).returning({ id: bookingServices.id }))[0],
      ).id;
      const availability = must(
        (await tx.insert(bookingAvailability).values({ tenantId: t, resourceId: resource, weekday: 1, startTime: "09:00", endTime: "13:00" }).returning({ id: bookingAvailability.id }))[0],
      ).id;
      const timeOff = must(
        (await tx
          .insert(bookingTimeOff)
          .values({ tenantId: t, resourceId: resource, startsAt: new Date("2030-01-01T00:00:00Z"), endsAt: new Date("2030-01-02T00:00:00Z") })
          .returning({ id: bookingTimeOff.id }))[0],
      ).id;
      const booking = must(
        (await tx
          .insert(bookings)
          .values({ tenantId: t, resourceId: resource, serviceId: service, contactId: contact, startsAt: new Date("2030-01-07T14:00:00Z"), endsAt: new Date("2030-01-07T14:30:00Z") })
          .returning({ id: bookings.id }))[0],
      ).id;
      return { tenant: t, contact, resource, service, availability, timeOff, booking };
    });
  }

  beforeAll(async () => {
    await runMigrations(MIGRATOR_URL as string);
    migrator = createDb(MIGRATOR_URL as string, { max: 1 });
    app = createDb(APP_URL as string, { max: 1 });
    A = await seed("a");
    B = await seed("b");
  });

  afterAll(async () => {
    if (migrator) {
      const ids = [A?.tenant, B?.tenant].filter((x): x is string => Boolean(x));
      if (ids.length) {
        await dangerouslyWithoutTenant(migrator.db, async (tx) => {
          await tx.delete(bookings).where(inArray(bookings.tenantId, ids));
          await tx.delete(tenants).where(inArray(tenants.id, ids));
        });
      }
      await migrator.close();
    }
    if (app) await app.close();
  });

  const tables = [
    ["booking_resources", bookingResources, "resource"],
    ["booking_services", bookingServices, "service"],
    ["booking_availability", bookingAvailability, "availability"],
    ["booking_time_off", bookingTimeOff, "timeOff"],
    ["bookings", bookings, "booking"],
  ] as const;

  for (const [name, table, key] of tables) {
    it(`${name}: tenant A only sees its own rows, and nothing without a tenant`, async () => {
      const rows = await withTenant(app.db, A.tenant, (tx) => tx.select({ id: table.id }).from(table));
      expect(rows.map((r) => r.id)).toEqual([A[key]]);
      expect(await app.db.select({ id: table.id }).from(table)).toHaveLength(0);
    });

    it(`${name}: tenant A cannot delete B's rows`, async () => {
      const del = await withTenant(app.db, A.tenant, (tx) => tx.delete(table).where(eq(table.id, B[key])).returning({ id: table.id }));
      expect(del).toHaveLength(0);
    });
  }

  it("tenant A cannot update B's rows", async () => {
    const r = await withTenant(app.db, A.tenant, (tx) => tx.update(bookingResources).set({ name: "x" }).where(eq(bookingResources.id, B.resource)).returning({ id: bookingResources.id }));
    expect(r).toHaveLength(0);
    const b = await withTenant(app.db, A.tenant, (tx) => tx.update(bookings).set({ status: "cancelled" }).where(eq(bookings.id, B.booking)).returning({ id: bookings.id }));
    expect(b).toHaveLength(0);
  });

  it("tenant A cannot insert rows for B nor reference B's resource/service/contact", async () => {
    expect(await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(bookingResources).values({ tenantId: B.tenant, name: "x" })))).toBeInstanceOf(Error);
    expect(await settle(withTenant(app.db, A.tenant, (tx) => tx.insert(bookingAvailability).values({ tenantId: A.tenant, resourceId: B.resource, weekday: 2, startTime: "09:00", endTime: "10:00" })))).toBeInstanceOf(Error);
    const cross = withTenant(app.db, A.tenant, (tx) =>
      tx.insert(bookings).values({ tenantId: A.tenant, resourceId: A.resource, serviceId: B.service, contactId: A.contact, startsAt: new Date("2030-02-04T14:00:00Z"), endsAt: new Date("2030-02-04T14:30:00Z") }),
    );
    expect(await settle(cross)).toBeInstanceOf(Error);
  });

  it("rejects overlapping active bookings on the same resource, but allows cancelled and back-to-back ones", async () => {
    const mk = (startsAt: string, endsAt: string, status: "pending" | "confirmed" | "cancelled" = "pending") =>
      withTenant(app.db, A.tenant, (tx) =>
        tx.insert(bookings).values({ tenantId: A.tenant, resourceId: A.resource, serviceId: A.service, contactId: A.contact, startsAt: new Date(startsAt), endsAt: new Date(endsAt), status }).returning({ id: bookings.id }),
      );
    expect(await settle(mk("2030-01-07T14:15:00Z", "2030-01-07T14:45:00Z", "confirmed"))).toBeInstanceOf(Error);
    expect(await settle(mk("2030-01-07T14:15:00Z", "2030-01-07T14:45:00Z", "cancelled"))).toBeUndefined();
    expect(await settle(mk("2030-01-07T14:30:00Z", "2030-01-07T15:00:00Z"))).toBeUndefined();
    // The same slot in tenant B is unaffected by A.
    const other = withTenant(app.db, B.tenant, (tx) =>
      tx.insert(bookings).values({ tenantId: B.tenant, resourceId: B.resource, serviceId: B.service, contactId: B.contact, startsAt: new Date("2030-01-07T14:30:00Z"), endsAt: new Date("2030-01-07T15:00:00Z") }),
    );
    expect(await settle(other)).toBeUndefined();
  });
});
