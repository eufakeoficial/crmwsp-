import type { MembershipRole } from "@crmwsp/contracts";

/** Roles that can be granted through an invitation (never owner). */
export const INVITABLE_ROLES = ["admin", "agent", "viewer"] as const satisfies readonly MembershipRole[];
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/** 7 days. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type TeamRuleViolation =
  | "not_a_manager"
  | "owner_not_invitable"
  | "only_owner_grants_admin"
  | "only_owner_grants_owner"
  | "cannot_modify_owner"
  | "last_owner";

export type TeamDecision = { allowed: true } | { allowed: false; reason: TeamRuleViolation };

const ok: TeamDecision = { allowed: true };
const deny = (reason: TeamRuleViolation): TeamDecision => ({ allowed: false, reason });
const isManager = (r: MembershipRole): boolean => r === "owner" || r === "admin";

/** Owner invites admin/agent/viewer; admin invites agent/viewer; nobody invites an owner. */
export function canInvite(actor: MembershipRole, role: MembershipRole): TeamDecision {
  if (!isManager(actor)) return deny("not_a_manager");
  if (role === "owner") return deny("owner_not_invitable");
  if (role === "admin" && actor !== "owner") return deny("only_owner_grants_admin");
  return ok;
}

/**
 * Role change of an existing member. Admins never touch owners and can only grant agent/viewer;
 * only an owner grants owner/admin. The last owner can never be demoted.
 */
export function canChangeRole(input: {
  actor: MembershipRole;
  current: MembershipRole;
  next: MembershipRole;
  ownerCount: number;
}): TeamDecision {
  const { actor, current, next, ownerCount } = input;
  if (!isManager(actor)) return deny("not_a_manager");
  if (current === "owner" && actor !== "owner") return deny("cannot_modify_owner");
  if (next === "owner" && actor !== "owner") return deny("only_owner_grants_owner");
  if (next === "admin" && actor !== "owner") return deny("only_owner_grants_admin");
  if (current === "owner" && next !== "owner" && ownerCount <= 1) return deny("last_owner");
  return ok;
}

/** Removal of a member: admins cannot remove owners; the last owner is never removed. */
export function canRemoveMember(input: { actor: MembershipRole; target: MembershipRole; ownerCount: number }): TeamDecision {
  const { actor, target, ownerCount } = input;
  if (!isManager(actor)) return deny("not_a_manager");
  if (target === "owner" && actor !== "owner") return deny("cannot_modify_owner");
  if (target === "owner" && ownerCount <= 1) return deny("last_owner");
  return ok;
}

/** Resend/revoke of a pending invitation: same rule as inviting with that role. */
export function canManageInvitation(actor: MembershipRole, role: MembershipRole): TeamDecision {
  return canInvite(actor, role);
}

/** Case-insensitive, trimmed email equality (the accepting user must be the invited one). */
export function sameEmail(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
