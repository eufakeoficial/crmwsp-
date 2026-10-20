import { NotFoundError, resolveInboxSettings, type InboxSettings, type MembershipRole } from "@crmwsp/contracts";
import { eq, sql, tenants, type Transaction } from "@crmwsp/db";
import type { SQL } from "./inbox.queries.js";

/** Roles restricted by the `own` visibility setting (owners and admins always see everything). */
const RESTRICTED_ROLES: ReadonlySet<MembershipRole> = new Set(["agent", "viewer"]);

export async function loadInboxSettings(tx: Transaction, tenantId: string): Promise<InboxSettings> {
  const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return resolveInboxSettings(t?.settings?.["inbox"]);
}

/**
 * Row filter (alias `c` = conversations) implementing the visibility setting: with `own`,
 * agents only see conversations assigned to them plus unassigned ones. null = no restriction.
 */
export function visibilityWhere(settings: InboxSettings, role: MembershipRole, userId: string): SQL | null {
  if (settings.visibility !== "own" || !RESTRICTED_ROLES.has(role)) return null;
  return sql`(c.assigned_user_id is null or c.assigned_user_id = ${userId}::uuid)`;
}

/** 404 (never 403: existence is not disclosed) when the conversation is outside the caller's scope. */
export async function assertConversationVisible(
  tx: Transaction,
  tenantId: string,
  role: MembershipRole,
  userId: string,
  conversationId: string,
): Promise<void> {
  const settings = await loadInboxSettings(tx, tenantId);
  const scope = visibilityWhere(settings, role, userId);
  const rows = await tx.execute<{ id: string }>(
    sql`select c.id from conversations c where c.id = ${conversationId}::uuid ${scope ? sql`and ${scope}` : sql``}`,
  );
  if (rows.length === 0) throw new NotFoundError();
}

/** Escapes LIKE wildcards so user input matches literally (default escape char is backslash). */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);
