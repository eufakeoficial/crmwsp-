import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { contacts } from "./contacts.js";
import { conversations } from "./conversations.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

// Appointment booking (migration 0066). FKs between tenant tables are composite (ADR 0002).
// The exclusion constraint `bookings_no_overlap` (btree_gist, tstzrange per resource for
// pending/confirmed) and the ON DELETE SET NULL (conversation_id) column list live only in SQL:
// drizzle-kit cannot express them.

export const bookingStatus = pgEnum("booking_status", ["pending", "confirmed", "cancelled", "completed", "no_show"]);
export const bookingSource = pgEnum("booking_source", ["manual", "ai"]);

export const bookingResources = pgTable(
  "booking_resources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    timezone: text("timezone").notNull().default("America/Lima"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("booking_resources_tenant_id_id_idx").on(t.tenantId, t.id)],
);

export const bookingServices = pgTable(
  "booking_services",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    active: boolean("active").notNull().default(true),
    priceMinor: bigint("price_minor", { mode: "bigint" }),
    currency: char("currency", { length: 3 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("booking_services_tenant_id_id_idx").on(t.tenantId, t.id)],
);

export const bookingAvailability = pgTable(
  "booking_availability",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    /** 0 = Sunday ... 6 = Saturday (JS `getDay()` convention). */
    weekday: smallint("weekday").notNull(),
    startTime: time("start_time").notNull(),
    endTime: time("end_time").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_availability_tenant_id_id_idx").on(t.tenantId, t.id),
    index("booking_availability_resource_idx").on(t.tenantId, t.resourceId, t.weekday),
    foreignKey({
      name: "booking_availability_tenant_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [bookingResources.tenantId, bookingResources.id],
    }).onDelete("cascade"),
  ],
);

export const bookingTimeOff = pgTable(
  "booking_time_off",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("booking_time_off_tenant_id_id_idx").on(t.tenantId, t.id),
    index("booking_time_off_resource_idx").on(t.tenantId, t.resourceId, t.startsAt),
    foreignKey({
      name: "booking_time_off_tenant_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [bookingResources.tenantId, bookingResources.id],
    }).onDelete("cascade"),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    resourceId: uuid("resource_id").notNull(),
    serviceId: uuid("service_id").notNull(),
    contactId: uuid("contact_id").notNull(),
    conversationId: uuid("conversation_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    status: bookingStatus("status").notNull().default("pending"),
    source: bookingSource("source").notNull().default("manual"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    lockVersion: integer("lock_version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("bookings_tenant_id_id_idx").on(t.tenantId, t.id),
    index("bookings_tenant_starts_idx").on(t.tenantId, t.startsAt),
    index("bookings_tenant_contact_idx").on(t.tenantId, t.contactId),
    foreignKey({
      name: "bookings_tenant_resource_fk",
      columns: [t.tenantId, t.resourceId],
      foreignColumns: [bookingResources.tenantId, bookingResources.id],
    }).onDelete("no action"),
    foreignKey({
      name: "bookings_tenant_service_fk",
      columns: [t.tenantId, t.serviceId],
      foreignColumns: [bookingServices.tenantId, bookingServices.id],
    }).onDelete("no action"),
    foreignKey({
      name: "bookings_tenant_contact_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bookings_tenant_conversation_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("set null"),
  ],
);

export type BookingResource = typeof bookingResources.$inferSelect;
export type BookingService = typeof bookingServices.$inferSelect;
export type BookingAvailabilityRow = typeof bookingAvailability.$inferSelect;
export type BookingTimeOffRow = typeof bookingTimeOff.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type NewBooking = typeof bookings.$inferInsert;
