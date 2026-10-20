import { updateContactFieldActionSchema } from "@crmwsp/contracts";
import { contacts, conversations, type Transaction } from "@crmwsp/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { applyDiscount, createQuoteDraft, createTask, moveStage } from "./sales-actions.js";

/**
 * Outcome of running an approved action.
 * - `executed`: done (or intentionally deferred, see `result.deferred`).
 * - `approved`: stays approved because it cannot run yet (`send_template`, until phase 4b).
 * - `failed`: the stored payload is unusable.
 */
export interface ActionOutcome {
  status: "executed" | "approved" | "failed";
  result: Record<string, unknown>;
}

export interface ActionRow {
  /** The `ai_actions` row id (links created tasks back to the action). */
  id?: string;
  conversationId: string | null;
  type: string;
  payload: Record<string, unknown>;
}

/**
 * Puts the conversation in `pending` when nobody is assigned to it. Returns whether it changed.
 * Bumps lock_version so inbox clients holding an If-Match notice the change.
 */
export async function applyConversationHandoff(tx: Transaction, conversationId: string, now: Date): Promise<boolean> {
  const rows = await tx
    .update(conversations)
    .set({ status: "pending", lockVersion: sql`${conversations.lockVersion} + 1`, updatedAt: now })
    .where(and(eq(conversations.id, conversationId), eq(conversations.status, "open"), isNull(conversations.assignedUserId)))
    .returning({ id: conversations.id });
  return rows.length > 0;
}

/** Runs one approved action. Callers persist the returned status/result. */
export async function runAction(tx: Transaction, row: ActionRow, now: Date): Promise<ActionOutcome> {
  switch (row.type) {
    case "update_contact_field": {
      const parsed = updateContactFieldActionSchema.safeParse(row.payload);
      if (!parsed.success || !row.conversationId) return { status: "failed", result: { error: "invalid_payload" } };
      const a = parsed.data;
      const [conv] = await tx
        .select({ contactId: conversations.contactId })
        .from(conversations)
        .where(eq(conversations.id, row.conversationId))
        .limit(1);
      if (!conv) return { status: "failed", result: { error: "conversation_not_found" } };
      const entry = { value: a.value, confidence: a.confidence, sourceMessageId: a.sourceMessageId, updatedAt: now.toISOString() };
      const patch = JSON.stringify(Object.fromEntries([[a.field, entry]]));
      await tx
        .update(contacts)
        .set({ extracted: sql`${contacts.extracted} || ${patch}::jsonb`, updatedAt: now })
        .where(eq(contacts.id, conv.contactId));
      return { status: "executed", result: { applied: true, field: a.field } };
    }
    case "create_task":
      return createTask(tx, row);
    case "move_stage":
      return moveStage(tx, row, now);
    case "create_quote_draft":
      return createQuoteDraft(tx, row, now);
    case "apply_discount":
      return applyDiscount(tx, row, now);
    case "send_template":
      // Needs the template tables/sync of phase 4b: stays approved (not executed) and flagged.
      return { status: "approved", result: { deferred: true, reason: "send_template_until_phase_4b" } };
    case "handoff": {
      if (!row.conversationId) return { status: "failed", result: { error: "invalid_payload" } };
      const changed = await applyConversationHandoff(tx, row.conversationId, now);
      return { status: "executed", result: { applied: true, conversationChanged: changed } };
    }
    default:
      return { status: "failed", result: { error: "unsupported_action_type" } };
  }
}
