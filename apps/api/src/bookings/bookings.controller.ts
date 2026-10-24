import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import {
  NotFoundError,
  ValidationError,
  availabilityQuerySchema,
  bookingTransitionRequestSchema,
  createBookingRequestSchema,
  listBookingsQuerySchema,
  rescheduleBookingRequestSchema,
  type AvailableSlot,
  type AvailableSlotsResponse,
  type Booking,
  type BookingStatus,
} from "@crmwsp/contracts";
import { and, asc, bookingResources, bookings, contacts, conversations, eq, gt, isUuid, lt, sql, type Transaction } from "@crmwsp/db";
import { canTransitionBooking, computeAvailableSlots, isActiveBookingStatus } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { ActivationGuard } from "../billing/activation.guard.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { modified } from "../sales/util.js";
import { assertBookable, loadBusy, loadResource, loadService, loadWindows, rethrowOverlap, toBooking } from "./bookings.queries.js";

async function loadBooking(tx: Transaction, id: string, lock = false): Promise<typeof bookings.$inferSelect> {
  const q = tx.select().from(bookings).where(eq(bookings.id, id));
  const [b] = lock ? await q.for("update") : await q;
  if (!b) throw new NotFoundError();
  return b;
}

/** Route segment -> target status. */
const TRANSITION_ROUTES: Record<string, BookingStatus> = {
  confirm: "confirmed",
  cancel: "cancelled",
  complete: "completed",
  "no-show": "no_show",
};

@Controller("bookings")
@UseGuards(TenantGuard, ActivationGuard)
export class BookingsController {
  @Get()
  async list(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<{ items: Booking[] }> {
    const q = parseOrThrow(listBookingsQuerySchema, query);
    const conds = [lt(bookings.startsAt, new Date(q.to)), gt(bookings.endsAt, new Date(q.from))];
    if (q.resourceId) conds.push(eq(bookings.resourceId, q.resourceId));
    const rows = await db.run((tx) => tx.select().from(bookings).where(and(...conds)).orderBy(asc(bookings.startsAt)).limit(2000));
    return { items: rows.map(toBooking) };
  }

  @Get("availability")
  async availability(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<AvailableSlotsResponse> {
    const q = parseOrThrow(availabilityQuerySchema, query);
    const from = new Date(q.from);
    const to = new Date(q.to);
    const now = new Date();
    return db.run(async (tx) => {
      const service = await loadService(tx, q.serviceId);
      if (!service.active) return { serviceId: service.id, slots: [] };
      const resources = q.resourceId
        ? [await loadResource(tx, q.resourceId)].filter((r) => r.active)
        : await tx.select().from(bookingResources).where(eq(bookingResources.active, true));
      const ids = resources.map((r) => r.id);
      const windows = await loadWindows(tx, ids);
      const busy = await loadBusy(tx, ids, from, to);
      const slots: AvailableSlot[] = [];
      for (const r of resources) {
        const b = busy.get(r.id) ?? { timeOff: [], bookings: [] };
        const found = computeAvailableSlots({
          availability: windows.get(r.id) ?? [],
          timeOff: b.timeOff,
          bookings: b.bookings,
          service: { durationMinutes: service.durationMinutes, bufferMinutes: service.bufferMinutes },
          from,
          to,
          tz: r.timezone,
          now,
          ...(q.stepMinutes !== undefined ? { stepMinutes: q.stepMinutes } : {}),
        });
        for (const s of found) slots.push({ resourceId: r.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString() });
      }
      slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.resourceId.localeCompare(b.resourceId));
      return { serviceId: service.id, slots };
    });
  }

  @Get(":id")
  async get(@CurrentTenantDb() db: TenantDb, @Param("id") id: string): Promise<Booking> {
    if (!isUuid(id)) throw new NotFoundError();
    return toBooking(await db.run((tx) => loadBooking(tx, id)));
  }

  @Post()
  @Roles("owner", "admin", "agent")
  async create(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<Booking> {
    const input = parseOrThrow(createBookingRequestSchema, body);
    const startsAt = new Date(input.startsAt);
    return db
      .run(async (tx) => {
        const resource = await loadResource(tx, input.resourceId, { lock: true });
        const service = await loadService(tx, input.serviceId);
        const [contact] = await tx.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contactId));
        if (!contact) throw new ValidationError("Contact not found");
        if (input.conversationId) {
          const [conv] = await tx.select({ contactId: conversations.contactId }).from(conversations).where(eq(conversations.id, input.conversationId));
          if (!conv || conv.contactId !== input.contactId) throw new ValidationError("Conversation does not belong to the contact");
        }
        const endsAt = await assertBookable(tx, resource, service, startsAt, new Date());
        const [row] = await tx
          .insert(bookings)
          .values({
            tenantId: db.tenantId,
            resourceId: resource.id,
            serviceId: service.id,
            contactId: input.contactId,
            conversationId: input.conversationId ?? null,
            startsAt,
            endsAt,
            status: input.status ?? "pending",
            source: "manual",
            notes: input.notes ?? null,
            createdBy: db.userId,
          })
          .returning();
        if (!row) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "booking",
          entityId: row.id,
          action: "booking.created",
          diff: { resourceId: row.resourceId, serviceId: row.serviceId, contactId: row.contactId, startsAt: input.startsAt, status: row.status },
          ip: req.ip,
        });
        return toBooking(row);
      })
      .catch(rethrowOverlap);
  }

  @Post(":id/reschedule")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async reschedule(@CurrentTenantDb() db: TenantDb, @Param("id") id: string, @Body() body: unknown, @Req() req: HttpRequest): Promise<Booking> {
    if (!isUuid(id)) throw new NotFoundError();
    const input = parseOrThrow(rescheduleBookingRequestSchema, body);
    const startsAt = new Date(input.startsAt);
    return db
      .run(async (tx) => {
        const before = await loadBooking(tx, id);
        const resourceId = input.resourceId ?? before.resourceId;
        // Lock order: resource(s) first, then the booking, so concurrent creates serialize with us.
        const ids = [...new Set([before.resourceId, resourceId])].sort();
        for (const rid of ids) await loadResource(tx, rid, { lock: true });
        const resource = await loadResource(tx, resourceId);
        const current = await loadBooking(tx, id, true);
        if (current.lockVersion !== input.lockVersion) throw modified("Booking");
        if (!isActiveBookingStatus(current.status)) throw new ValidationError(`A ${current.status} booking cannot be rescheduled`);
        const service = await loadService(tx, current.serviceId);
        const endsAt = await assertBookable(tx, resource, service, startsAt, new Date(), id);
        const [row] = await tx
          .update(bookings)
          .set({ resourceId, startsAt, endsAt, lockVersion: sql`${bookings.lockVersion} + 1`, updatedAt: new Date() })
          .where(and(eq(bookings.id, id), eq(bookings.lockVersion, input.lockVersion)))
          .returning();
        if (!row) throw modified("Booking");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "booking",
          entityId: id,
          action: "booking.rescheduled",
          diff: { from: { resourceId: current.resourceId, startsAt: current.startsAt.toISOString() }, to: { resourceId, startsAt: input.startsAt } },
          ip: req.ip,
        });
        return toBooking(row);
      })
      .catch(rethrowOverlap);
  }

  @Post(":id/:transition")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  async transition(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Param("transition") transition: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<Booking> {
    const target = Object.hasOwn(TRANSITION_ROUTES, transition) ? TRANSITION_ROUTES[transition] : undefined;
    if (!isUuid(id) || !target) throw new NotFoundError();
    const input = parseOrThrow(bookingTransitionRequestSchema, body ?? {});
    return db.run(async (tx) => {
      const before = await loadBooking(tx, id, true);
      if (before.lockVersion !== input.lockVersion) throw modified("Booking");
      if (!canTransitionBooking(before.status, target)) throw new ValidationError(`A ${before.status} booking cannot become ${target}`);
      if ((target === "completed" || target === "no_show") && before.startsAt.getTime() > Date.now()) {
        throw new ValidationError("Only bookings that already started can be marked completed or no-show");
      }
      const [row] = await tx
        .update(bookings)
        .set({ status: target, lockVersion: sql`${bookings.lockVersion} + 1`, updatedAt: new Date() })
        .where(and(eq(bookings.id, id), eq(bookings.lockVersion, input.lockVersion)))
        .returning();
      if (!row) throw modified("Booking");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "booking",
        entityId: id,
        action: `booking.${target}`,
        diff: { from: before.status, to: target },
        ip: req.ip,
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return toBooking(row);
    });
  }
}
