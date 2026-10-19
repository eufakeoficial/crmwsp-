import { sql } from "drizzle-orm";
import { index, inet, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";

export const auditActorType = pgEnum("audit_actor_type", ["user", "ai", "system"]);

/** Append-only audit log: the app role may INSERT and SELECT, never UPDATE/DELETE. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    actorType: auditActorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    entity: text("entity").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default({}),
    ip: inet("ip"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_tenant_id_id_idx").on(t.tenantId, t.id)],
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type AuditActorType = (typeof auditActorType.enumValues)[number];
