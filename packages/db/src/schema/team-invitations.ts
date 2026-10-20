import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { membershipRole } from "./memberships.js";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

import { bytea } from "./channel-connections.js";

/**
 * Pending/used invitations to join a tenant. Only the SHA-256 of the token is stored. RLS by
 * tenant_id (0050); the public token lookup/accept go through SECURITY DEFINER functions.
 */
export const teamInvitations = pgTable(
  "team_invitations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** Lower-cased. */
    email: text("email").notNull(),
    role: membershipRole("role").notNull(),
    tokenHash: bytea("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSentAt: timestamp("last_sent_at", { withTimezone: true }).notNull().defaultNow(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedBy: uuid("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("team_invitations_token_hash_unique").on(t.tokenHash),
    uniqueIndex("team_invitations_pending_email_unique")
      .on(t.tenantId, t.email)
      .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    index("team_invitations_tenant_id_id_idx").on(t.tenantId, t.id),
    check("team_invitations_role_not_owner", sql`${t.role} <> 'owner'`),
    check("team_invitations_token_hash_len", sql`octet_length(${t.tokenHash}) = 32`),
    check("team_invitations_email_lower", sql`${t.email} = lower(${t.email}) AND length(${t.email}) BETWEEN 3 AND 320`),
  ],
);

export type TeamInvitation = typeof teamInvitations.$inferSelect;
export type NewTeamInvitation = typeof teamInvitations.$inferInsert;
