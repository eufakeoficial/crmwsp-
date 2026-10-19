import { sql } from "drizzle-orm";
import { index, inet, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./channel-connections.js";
import { users } from "./users.js";

/**
 * Opaque login sessions (owned by a user, not by a tenant). Only the SHA-256
 * of the session token is stored. System-only table: the app role has no
 * grants; it uses the SECURITY DEFINER functions create_session,
 * resolve_session and revoke_session (drizzle/0006_auth_sessions.sql).
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: bytea("token_hash").notNull().unique("sessions_token_hash_unique"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId), index("sessions_expires_at_idx").on(t.expiresAt)],
);

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
