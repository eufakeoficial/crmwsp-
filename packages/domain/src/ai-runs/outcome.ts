import type { AiRunMode, AiRunOutcome } from "@crmwsp/contracts";

/** Action types of `ai_actions` that represent one AI run (reply, draft or handoff). */
export const AI_RUN_ACTION_TYPES = ["send_reply", "draft_reply", "handoff"] as const;

/** Handoffs caused by a limit (budget / plan), not by a failure. */
export const AI_BLOCKED_REASONS = ["budget_exceeded", "plan_limit_reached"] as const;

/** Handoffs caused by a technical failure; mirrors `handoffReasonFor` in the worker. */
export const AI_ERROR_REASONS = ["invalid_output", "credentials_unavailable", "provider_unavailable", "provider_error"] as const;
export const AI_ERROR_REASON_PREFIX = "provider_error_";

export function isBlockedReason(reason: string | null): boolean {
  return reason !== null && (AI_BLOCKED_REASONS as readonly string[]).includes(reason);
}

export function isErrorReason(reason: string | null): boolean {
  if (reason === null) return false;
  return (AI_ERROR_REASONS as readonly string[]).includes(reason) || reason.startsWith(AI_ERROR_REASON_PREFIX);
}

/** Outcome and mode shown for one AI action row; null when the action type is not a run. */
export function classifyAiRun(type: string, reason: string | null): { outcome: AiRunOutcome; mode: AiRunMode | null } | null {
  switch (type) {
    case "send_reply":
      return { outcome: "sent", mode: "auto" };
    case "draft_reply":
      return { outcome: "draft", mode: "draft" };
    case "handoff":
      if (isBlockedReason(reason)) return { outcome: "blocked", mode: null };
      if (isErrorReason(reason)) return { outcome: "error", mode: null };
      return { outcome: "handoff", mode: null };
    default:
      return null;
  }
}
