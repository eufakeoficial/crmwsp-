import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Password credentials (one row per user). System-only table: the app role has
 * no grants and no RLS policy here. Login reads it exclusively through the
 * SECURITY DEFINER function `auth_login` (drizzle/0006_auth_sessions.sql).
 */
export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UserCredential = typeof userCredentials.$inferSelect;
export type NewUserCredential = typeof userCredentials.$inferInsert;
