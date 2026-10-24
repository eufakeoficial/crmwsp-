import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  createBookingResourceRequestSchema,
  createBookingServiceRequestSchema,
  createTimeOffRequestSchema,
  patchBookingResourceRequestSchema,
  patchBookingServiceRequestSchema,
  putAvailabilityRequestSchema,
  type AvailabilityResponse,
  type BookingResource,
  type BookingService,
  type TimeOff,
} from "@crmwsp/contracts";
import { and, asc, bookingAvailability, bookingResources, bookingServices, bookingTimeOff, eq, isUuid, tenants } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { pgCode, writeAudit } from "../inbox/audit.js";
import { assertMember } from "../sales/util.js";
import { PG_FK_VIOLATION, hhmm, loadResource, loadService, toPgTime, toResource, toService, toTimeOff } from "./bookings.queries.js";

const inUse = (what: string) => (err: unknown): never => {
  if (pgCode(err) === PG_FK_VIOLATION) throw new ConflictError(`${what} has bookings; deactivate it instead`);
  throw err;
};

@Controller("booking-resources")
@UseGuards(TenantGuard)
export class BookingResourcesController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb): Promise<{ items: BookingResource[] }> {
    const rows = await db.run((tx) => tx.select().from(bookingResources).orderBy(asc(bookingResources.name)));
    return { items: rows.map(toResource) };
  }

  @Post()
  @Roles("owner", "admin")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<BookingResource> {
    const input = parseOrThrow(createBookingResourceRequestSchema, body);
    return db.run(async (tx) => {
      if (input.userId) await assertMember(tx, input.userId, "User");
      let timezone = input.timezone;
      if (!timezone) {
        const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).where(eq(tenants.id, db.tenantId));
        timezone = t?.tz ?? "America/Lima";
      }
      const [row] = await tx
        .insert(bookingResources)
        .values({ tenantId: db.tenantId, name: input.name, timezone, userId: input.userId ?? null, active: input.active ?? true })
        .returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_resource", entityId: row.id, action: "booking_resource.created", diff: { name: input.name, timezone }, ip: req.ip });
      return toResource(row);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<BookingResource> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchBookingResourceRequestSchema, body);
    if (Object.keys(input).length === 0) throw new ValidationError("Nothing to update");
    return db.run(async (tx) => {
      await loadResource(tx, id, { lock: true });
      if (input.userId) await assertMember(tx, input.userId, "User");
      const set: Partial<typeof bookingResources.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.timezone !== undefined) set.timezone = input.timezone;
      if (input.userId !== undefined) set.userId = input.userId;
      if (input.active !== undefined) set.active = input.active;
      const [row] = await tx.update(bookingResources).set(set).where(eq(bookingResources.id, id)).returning();
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_resource", entityId: id, action: "booking_resource.updated", diff: { ...input }, ip: req.ip });
      return toResource(row);
    });
  }

  @Delete(":id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db
      .run(async (tx) => {
        const [row] = await tx.delete(bookingResources).where(eq(bookingResources.id, id)).returning({ id: bookingResources.id });
        if (!row) throw new NotFoundError();
        await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_resource", entityId: id, action: "booking_resource.deleted", ip: req.ip });
      })
      .catch(inUse("The resource"));
  }

  @Get(":id/availability")
  async getAvailability(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<AvailabilityResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      await loadResource(tx, id);
      const rows = await tx
        .select()
        .from(bookingAvailability)
        .where(eq(bookingAvailability.resourceId, id))
        .orderBy(asc(bookingAvailability.weekday), asc(bookingAvailability.startTime));
      return { resourceId: id, windows: rows.map((r) => ({ weekday: r.weekday, startTime: hhmm(r.startTime), endTime: hhmm(r.endTime) })) };
    });
  }

  /** Replaces the whole weekly schedule. Existing bookings are kept even if now outside hours. */
  @Put(":id/availability")
  @Roles("owner", "admin")
  @HttpCode(200)
  async putAvailability(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<AvailabilityResponse> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(putAvailabilityRequestSchema, body);
    return db.run(async (tx) => {
      await loadResource(tx, id, { lock: true });
      await tx.delete(bookingAvailability).where(eq(bookingAvailability.resourceId, id));
      if (input.windows.length > 0) {
        await tx.insert(bookingAvailability).values(
          input.windows.map((w) => ({ tenantId: db.tenantId, resourceId: id, weekday: w.weekday, startTime: toPgTime(w.startTime), endTime: toPgTime(w.endTime) })),
        );
      }
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_resource", entityId: id, action: "booking_availability.replaced", diff: { windows: input.windows }, ip: req.ip });
      const windows = [...input.windows].sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime));
      return { resourceId: id, windows };
    });
  }

  @Get(":id/time-off")
  async listTimeOff(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<{ items: TimeOff[] }> {
    if (!isUuid(id)) throw new NotFoundError();
    return db.run(async (tx) => {
      await loadResource(tx, id);
      const rows = await tx.select().from(bookingTimeOff).where(eq(bookingTimeOff.resourceId, id)).orderBy(asc(bookingTimeOff.startsAt));
      return { items: rows.map(toTimeOff) };
    });
  }

  /** Time off may overlap existing bookings; those are not cancelled automatically. */
  @Post(":id/time-off")
  @Roles("owner", "admin")
  async createTimeOff(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<TimeOff> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(createTimeOffRequestSchema, body);
    return db.run(async (tx) => {
      await loadResource(tx, id, { lock: true });
      const [row] = await tx
        .insert(bookingTimeOff)
        .values({ tenantId: db.tenantId, resourceId: id, startsAt: new Date(input.startsAt), endsAt: new Date(input.endsAt), reason: input.reason ?? null })
        .returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_time_off", entityId: row.id, action: "booking_time_off.created", diff: { resourceId: id, startsAt: input.startsAt, endsAt: input.endsAt }, ip: req.ip });
      return toTimeOff(row);
    });
  }

  @Delete(":id/time-off/:timeOffId")
  @Roles("owner", "admin")
  @HttpCode(204)
  async deleteTimeOff(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Param("timeOffId") timeOffId: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id) || !isUuid(timeOffId)) throw new NotFoundError();
    await db.run(async (tx) => {
      const [row] = await tx
        .delete(bookingTimeOff)
        .where(and(eq(bookingTimeOff.id, timeOffId), eq(bookingTimeOff.resourceId, id)))
        .returning({ id: bookingTimeOff.id });
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_time_off", entityId: timeOffId, action: "booking_time_off.deleted", ip: req.ip });
    });
  }
}

@Controller("booking-services")
@UseGuards(TenantGuard)
export class BookingServicesController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb): Promise<{ items: BookingService[] }> {
    const rows = await db.run((tx) => tx.select().from(bookingServices).orderBy(asc(bookingServices.name)));
    return { items: rows.map(toService) };
  }

  @Post()
  @Roles("owner", "admin")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<BookingService> {
    const input = parseOrThrow(createBookingServiceRequestSchema, body);
    return db.run(async (tx) => {
      const [row] = await tx
        .insert(bookingServices)
        .values({
          tenantId: db.tenantId,
          name: input.name,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes ?? 0,
          active: input.active ?? true,
          priceMinor: input.priceMinor == null ? null : BigInt(input.priceMinor),
          currency: input.currency ?? null,
        })
        .returning();
      if (!row) throw new Error("insert returned no row");
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_service", entityId: row.id, action: "booking_service.created", diff: { ...input }, ip: req.ip });
      return toService(row);
    });
  }

  @Patch(":id")
  @Roles("owner", "admin")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<BookingService> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(patchBookingServiceRequestSchema, body);
    if (Object.keys(input).length === 0) throw new ValidationError("Nothing to update");
    return db.run(async (tx) => {
      await loadService(tx, id);
      const set: Partial<typeof bookingServices.$inferInsert> = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.durationMinutes !== undefined) set.durationMinutes = input.durationMinutes;
      if (input.bufferMinutes !== undefined) set.bufferMinutes = input.bufferMinutes;
      if (input.active !== undefined) set.active = input.active;
      if (input.priceMinor !== undefined) set.priceMinor = input.priceMinor === null ? null : BigInt(input.priceMinor);
      if (input.currency !== undefined) set.currency = input.currency;
      const [row] = await tx.update(bookingServices).set(set).where(eq(bookingServices.id, id)).returning();
      if (!row) throw new NotFoundError();
      await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_service", entityId: id, action: "booking_service.updated", diff: { ...input }, ip: req.ip });
      return toService(row);
    });
  }

  @Delete(":id")
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Req() req: HttpRequest): Promise<void> {
    if (!isUuid(id)) throw new NotFoundError();
    await db
      .run(async (tx) => {
        const [row] = await tx.delete(bookingServices).where(eq(bookingServices.id, id)).returning({ id: bookingServices.id });
        if (!row) throw new NotFoundError();
        await writeAudit(tx, { tenantId: db.tenantId, userId: db.userId, entity: "booking_service", entityId: id, action: "booking_service.deleted", ip: req.ip });
      })
      .catch(inUse("The service"));
  }
}
