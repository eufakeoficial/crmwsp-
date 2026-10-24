import type { MembershipRole, SupportCannedVariable, SupportTicketStatus } from "@crmwsp/contracts";
import { SUPPORT_CANNED_VARIABLES } from "@crmwsp/contracts";

/**
 * Support ticket rules (ADR 0016). The status changes are mirrored in SQL by the
 * `platform_support_reply` function (migration 0075) and in the tenant API: keep them in sync.
 */

/** A tenant reply reopens tickets the platform was done with. */
export function statusAfterTenantReply(status: SupportTicketStatus): SupportTicketStatus {
  return status === "waiting_customer" || status === "resolved" ? "open" : status;
}

/** A public admin reply hands the ball to the customer; internal notes change nothing. */
export function statusAfterAdminReply(status: SupportTicketStatus, internal: boolean): SupportTicketStatus {
  if (internal || status === "resolved") return status;
  return "waiting_customer";
}

export function canTenantClose(status: SupportTicketStatus): boolean {
  return status !== "resolved";
}

/** Owners/admins see every ticket of their tenant; other members only the ones they opened. */
export function canViewSupportTicket(viewer: { userId: string; role: MembershipRole }, createdBy: string | null): boolean {
  if (viewer.role === "owner" || viewer.role === "admin") return true;
  return createdBy !== null && createdBy === viewer.userId;
}

export function seesAllSupportTickets(role: MembershipRole): boolean {
  return role === "owner" || role === "admin";
}

const KNOWN = new Set<string>(SUPPORT_CANNED_VARIABLES);
const VAR_RE = /\{\{\s*([a-z_]+)\s*\}\}/gi;

/**
 * Expands `{{nombre}}`, `{{negocio}}`, `{{ticket}}` and `{{asunto}}` in one pass (values are not
 * re-expanded). Unknown variables stay as written so a typo is visible before sending.
 */
export function renderCannedResponse(template: string, vars: Partial<Record<SupportCannedVariable, string>>): string {
  return template.replace(VAR_RE, (match, name: string) => {
    const key = name.toLowerCase();
    if (!KNOWN.has(key)) return match;
    return vars[key as SupportCannedVariable] ?? "";
  });
}
