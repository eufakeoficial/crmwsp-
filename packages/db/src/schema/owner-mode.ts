import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { channelConnections } from "./channel-connections.js";
import { memberships } from "./memberships.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

export const ownerPhoneStatuses = ["pending", "verified"] as const;
export type OwnerPhoneStatus = (typeof ownerPhoneStatuses)[number];

/**
 * WhatsApp number of a team member allowed to run the CRM from WhatsApp (F9 "modo dueño").
 * One per membership. The verification code is stored only as a salted SHA-256 hash.
 * Only `verified` rows route inbound messages to the owner-mode handler.
 */
export const ownerPhones = pgTable(
  "owner_phones",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Composite FK (tenant_id, membership_id) below: same-tenant membership only.
    membershipId: uuid("membership_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    phoneE164: text("phone_e164").notNull(),
    status: text("status", { enum: ownerPhoneStatuses }).notNull().default("pending"),
    codeHash: text("code_hash"),
    codeSalt: text("code_salt"),
    codeExpiresAt: timestamp("code_expires_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("owner_phones_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("owner_phones_tenant_phone_unique").on(t.tenantId, t.phoneE164),
    uniqueIndex("owner_phones_tenant_membership_unique").on(t.tenantId, t.membershipId),
    foreignKey({
      name: "owner_phones_tenant_membership_fk",
      columns: [t.tenantId, t.membershipId],
      foreignColumns: [memberships.tenantId, memberships.id],
    }).onDelete("cascade"),
    check("owner_phones_status_check", sql`${t.status} IN ('pending', 'verified')`),
    check("owner_phones_phone_check", sql`${t.phoneE164} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("owner_phones_attempts_check", sql`${t.attempts} >= 0`),
  ],
);

export const ownerCommandStatuses = [
  "received",
  "answered",
  "awaiting_confirmation",
  "confirmed",
  "cancelled",
  "expired",
  "rejected",
  "failed",
] as const;
export type OwnerCommandStatus = (typeof ownerCommandStatuses)[number];

/**
 * One inbound owner-mode message and what was done with it (audit + rate limit + pending
 * confirmations). Mutating commands wait in `awaiting_confirmation` with a hashed nonce until
 * the owner confirms ("sí 123456") before `expires_at`; a consumed nonce cannot be replayed.
 */
export const ownerCommands = pgTable(
  "owner_commands",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ownerPhoneId: uuid("owner_phone_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channelConnectionId: uuid("channel_connection_id").notNull(),
    inboundExternalId: text("inbound_external_id").notNull(),
    body: text("body"),
    intent: text("intent"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status", { enum: ownerCommandStatuses }).notNull().default("received"),
    nonceHash: text("nonce_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    reply: text("reply"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("owner_commands_tenant_id_id_idx").on(t.tenantId, t.id),
    uniqueIndex("owner_commands_tenant_external_unique").on(t.tenantId, t.inboundExternalId),
    index("owner_commands_tenant_phone_created_idx").on(t.tenantId, t.ownerPhoneId, t.createdAt.desc()),
    foreignKey({
      name: "owner_commands_tenant_phone_fk",
      columns: [t.tenantId, t.ownerPhoneId],
      foreignColumns: [ownerPhones.tenantId, ownerPhones.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "owner_commands_tenant_channel_fk",
      columns: [t.tenantId, t.channelConnectionId],
      foreignColumns: [channelConnections.tenantId, channelConnections.id],
    }).onDelete("cascade"),
    check(
      "owner_commands_status_check",
      sql`${t.status} IN ('received', 'answered', 'awaiting_confirmation', 'confirmed', 'cancelled', 'expired', 'rejected', 'failed')`,
    ),
    check("owner_commands_pending_nonce_check", sql`${t.status} <> 'awaiting_confirmation' OR (${t.nonceHash} IS NOT NULL AND ${t.expiresAt} IS NOT NULL)`),
  ],
);

/**
 * Tenant-wide AI pause switch (owner-mode "pausar IA"). One row per tenant; while `paused_at`
 * is set, ingest schedules no AI turns. Per-conversation `ai_mode` is left untouched.
 */
export const aiPauses = pgTable(
  "ai_pauses",
  {
    tenantId: uuid("tenant_id")
      .primaryKey()
      .references(() => tenants.id, { onDelete: "cascade" }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    pausedBy: uuid("paused_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);

export type OwnerPhone = typeof ownerPhones.$inferSelect;
export type NewOwnerPhone = typeof ownerPhones.$inferInsert;
export type OwnerCommand = typeof ownerCommands.$inferSelect;
export type NewOwnerCommand = typeof ownerCommands.$inferInsert;
export type AiPause = typeof aiPauses.$inferSelect;
