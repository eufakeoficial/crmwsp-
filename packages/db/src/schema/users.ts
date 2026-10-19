import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

/**
 * Global identity (no tenant_id). RLS (drizzle/0004_rls_users.sql): the app
 * role only sees users with a membership in `app.tenant_id` and may only
 * update its own row (`app.user_id`). No INSERT/DELETE for the app role.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    email: text("email").notNull(),
    name: text("name"),
    authProvider: text("auth_provider"),
    authProviderId: text("auth_provider_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
