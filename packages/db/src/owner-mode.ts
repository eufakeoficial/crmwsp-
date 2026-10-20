import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { Transaction } from "./client.js";
import { actionApprovals, aiActions } from "./schema/ai-actions.js";
import { auditEvents } from "./schema/audit-events.js";
import { memberships } from "./schema/memberships.js";
import { aiPauses, ownerPhones } from "./schema/owner-mode.js";
import { quotes } from "./schema/quotes.js";
import { isUuid } from "./with-tenant.js";

/* F9 "modo dueño" helpers shared by the API (phone registration) and the worker (inbound routing). */

/** Uniform 6-digit secret (verification codes and confirmation nonces). */
export function newOwnerSecret(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function newOwnerSalt(): string {
  return randomBytes(16).toString("hex");
}

/** SHA-256 of salt + scope + secret; the scope binds a nonce to its command (no cross-command reuse). */
export function hashOwnerSecret(secret: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

/** Constant-time comparison of a stored hash with a candidate secret. */
export function ownerSecretMatches(storedHash: string | null, secret: string, salt: string): boolean {
  if (!storedHash) return false;
  const a = Buffer.from(storedHash, "hex");
  const b = Buffer.from(hashOwnerSecret(secret, salt), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface VerifiedOwner {
  ownerPhoneId: string;
  userId: string;
  membershipId: string;
  role: "owner" | "admin";
}

/**
 * Verified owner phone of the current tenant (RLS) whose membership still has role owner/admin.
 * The match is exact on the normalised E.164 string; a pending or demoted member returns null.
 */
export async function findVerifiedOwner(tx: Transaction, phoneE164: string): Promise<VerifiedOwner | null> {
  const [row] = await tx
    .select({ ownerPhoneId: ownerPhones.id, userId: ownerPhones.userId, membershipId: ownerPhones.membershipId, role: memberships.role })
    .from(ownerPhones)
    .innerJoin(memberships, and(eq(memberships.id, ownerPhones.membershipId), eq(memberships.userId, ownerPhones.userId)))
    .where(
      and(
        eq(ownerPhones.phoneE164, phoneE164),
        eq(ownerPhones.status, "verified"),
        isNotNull(ownerPhones.verifiedAt),
        inArray(memberships.role, ["owner", "admin"]),
      ),
    )
    .limit(1);
  if (!row || (row.role !== "owner" && row.role !== "admin")) return null;
  return { ownerPhoneId: row.ownerPhoneId, userId: row.userId, membershipId: row.membershipId, role: row.role };
}

/** True when the tenant paused AI from owner mode (ingest then schedules no AI turns). */
export async function isTenantAiPaused(tx: Transaction): Promise<boolean> {
  const [row] = await tx.select({ pausedAt: aiPauses.pausedAt }).from(aiPauses).limit(1);
  return Boolean(row?.pausedAt);
}

export async function setTenantAiPaused(tx: Transaction, tenantId: string, paused: boolean, userId: string): Promise<void> {
  const now = new Date();
  await tx
    .insert(aiPauses)
    .values({ tenantId, pausedAt: paused ? now : null, pausedBy: userId, updatedAt: now })
    .onConflictDoUpdate({ target: aiPauses.tenantId, set: { pausedAt: paused ? now : null, pausedBy: userId, updatedAt: now } });
}

export type AiActionDecisionResult =
  | { ok: true; id: string; status: "approved" | "rejected"; type: string }
  | { ok: false; reason: "not_found" | "not_pending"; status?: string };

/**
 * Human decision on a `pending_approval` AI action. Same rules as POST /ai/actions/:id/approve|reject:
 * decision row + status + audit in the caller's transaction; a rejected quote approval also rejects
 * the quote. Approval does not execute: the caller enqueues `execute-ai-action` after commit.
 */
export async function decideAiActionAsUser(
  tx: Transaction,
  input: { tenantId: string; actionId: string; userId: string; decision: "approved" | "rejected"; note?: string | null; source: string },
): Promise<AiActionDecisionResult> {
  const [action] = await tx.select().from(aiActions).where(eq(aiActions.id, input.actionId)).for("update");
  if (!action) return { ok: false, reason: "not_found" };
  if (action.status !== "pending_approval") return { ok: false, reason: "not_pending", status: action.status };
  await tx.insert(actionApprovals).values({
    tenantId: input.tenantId,
    actionId: action.id,
    decidedBy: input.userId,
    decision: input.decision,
    note: input.note ?? null,
  });
  await tx.update(aiActions).set({ status: input.decision }).where(eq(aiActions.id, action.id));
  const quoteId = action.type === "create_quote_draft" ? action.payload["quoteId"] : undefined;
  if (input.decision === "rejected" && isUuid(quoteId)) {
    await tx
      .update(quotes)
      .set({ status: "rejected", lockVersion: sql`${quotes.lockVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(quotes.id, quoteId), eq(quotes.status, "pending_approval")));
  }
  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorType: "user",
    actorId: input.userId,
    entity: "ai_action",
    entityId: action.id,
    action: input.decision === "approved" ? "ai_action.approved" : "ai_action.rejected",
    diff: {
      status: { from: "pending_approval", to: input.decision },
      type: action.type,
      source: input.source,
      ...(input.note ? { note: input.note } : {}),
    },
  });
  return { ok: true, id: action.id, status: input.decision, type: action.type };
}
