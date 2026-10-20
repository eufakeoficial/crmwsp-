import { aiActionSchema, FACTUAL_CLAIM_KINDS } from "@crmwsp/contracts";
import type { AiAction, AiActionType, AiDecision, AiTurnOutput } from "@crmwsp/contracts";

/**
 * Generic pipeline order. Only forward moves into `AUTO_STAGE_LIMIT` or earlier may run
 * automatically; anything else (backwards, closing stages, unknown stages) needs approval.
 */
export const PIPELINE_STAGES = ["new", "contacted", "qualified", "quote_sent", "negotiation", "won", "lost"] as const;
export const AUTO_STAGE_LIMIT = "qualified";

export const MAX_DISCOUNT_PERCENT = 50;

export interface TenantAiPolicies {
  /** Per-action overrides. They can only make a decision stricter, never looser. */
  actionOverrides?: Partial<Record<AiActionType, AiDecision>>;
  /** Forces every non-denied action to approval. */
  requireApprovalForAll?: boolean;
}

export interface AiPolicyContext {
  validChunkIds: ReadonlySet<string>;
  confidenceThreshold: number;
  /**
   * Intentionally unused today: every `create_quote_draft` and `apply_discount` already goes
   * to `approve` regardless of amount, which is stricter than any threshold could be. Kept in
   * the context so a future rule can AUTO-approve small quotes without changing callers; such
   * a rule must still never loosen a tenant override (ADR 0003).
   */
  approvalThresholdMinor: number;
  policies: TenantAiPolicies;
  now: Date;
  /** `auto` sends replies directly; `assist` only drafts them for a human. Default `auto`. */
  mode?: "auto" | "assist";
  /** Current opportunity stage, if any. */
  currentStage?: string;
}

export interface ActionEvaluation {
  action: AiAction | unknown;
  decision: AiDecision;
  reason: string;
}

export interface TurnEvaluation {
  reply: { allowed: boolean; reason: string; draft?: boolean };
  actions: ActionEvaluation[];
}

const SEVERITY: Record<AiDecision, number> = { auto: 0, approve: 1, deny: 2 };
const stricter = (a: AiDecision, b: AiDecision): AiDecision => (SEVERITY[b] > SEVERITY[a] ? b : a);

function stageIndex(stage: string | undefined): number {
  return stage === undefined ? -1 : (PIPELINE_STAGES as readonly string[]).indexOf(stage);
}

function isValidConfidence(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function baseDecision(action: AiAction, ctx: AiPolicyContext): { decision: AiDecision; reason: string } {
  switch (action.type) {
    case "update_contact_field":
      return action.confidence >= ctx.confidenceThreshold
        ? { decision: "auto", reason: "field confidence above threshold" }
        : { decision: "approve", reason: "field confidence below threshold" };
    case "create_task":
      if (action.dueAt !== undefined && Date.parse(action.dueAt) < ctx.now.getTime()) {
        return { decision: "approve", reason: "task due date is in the past" };
      }
      return { decision: "auto", reason: "tasks are low risk" };
    case "move_stage": {
      const target = stageIndex(action.stage);
      const current = ctx.currentStage === undefined ? 0 : stageIndex(ctx.currentStage);
      if (target < 0) return { decision: "approve", reason: "unknown stage" };
      if (current >= 0 && target > current && target <= stageIndex(AUTO_STAGE_LIMIT)) {
        return { decision: "auto", reason: "forward move within initial stages" };
      }
      return { decision: "approve", reason: "backward or late-stage move" };
    }
    case "create_quote_draft": {
      const bad = action.items.find((i) => !ctx.validChunkIds.has(i.chunkId));
      return bad
        ? { decision: "deny", reason: "quote references an unknown chunk" }
        : { decision: "approve", reason: "quotes always require approval" };
    }
    case "apply_discount":
      if (!Number.isFinite(action.percent) || action.percent < 0 || action.percent > MAX_DISCOUNT_PERCENT) {
        return { decision: "deny", reason: `discount outside 0..${MAX_DISCOUNT_PERCENT}%` };
      }
      return { decision: "approve", reason: "discounts always require approval" };
    case "send_template":
      return { decision: "approve", reason: "proactive templates require approval" };
    case "handoff":
      return { decision: "auto", reason: "handoff to a human is always allowed" };
    default:
      return { decision: "deny", reason: "unknown action" };
  }
}

/** Evaluates a single action. Unknown or malformed actions are denied. */
export function evaluateAction(raw: unknown, ctx: AiPolicyContext): ActionEvaluation {
  const parsed = aiActionSchema.safeParse(raw);
  if (!parsed.success) return { action: raw, decision: "deny", reason: "unknown or malformed action" };
  const action = parsed.data;
  let { decision, reason } = baseDecision(action, ctx);
  // Handoff is a safety valve: tenant policies cannot block it.
  if (action.type !== "handoff") {
    const override = ctx.policies.actionOverrides?.[action.type];
    if (override && stricter(decision, override) !== decision) {
      decision = override;
      reason = `${reason}; tightened by tenant policy`;
    }
    if (ctx.policies.requireApprovalForAll && decision === "auto") {
      decision = "approve";
      reason = `${reason}; tenant requires approval for all actions`;
    }
  }
  return { action, decision, reason };
}

/*
 * Heuristic detectors for factual content smuggled outside a factual claim (e.g. a claim of
 * kind `other` saying "cuesta 780 €", or a reply text with a price and no claims at all).
 * Deliberately broad: a false positive costs a handoff, a false negative an invented price.
 */
const CURRENCY = String.raw`(?:€|\$|us\$|u\$s|s\/|£|r\$|eur(?:os?)?|usd|d[oó]lar(?:es)?|pesos?|soles?|mxn|ars|clp|cop|pen|uyu|brl|gs)`;
const FACTUAL_PATTERNS: Record<"price" | "discount" | "stock" | "lead_time", RegExp> = {
  price: new RegExp(String.raw`(?:${CURRENCY}\s?\d)|(?:\d[\d.,]*\s?(?:k\s?)?${CURRENCY}(?![a-z]))|\b(?:precio|cuesta|cuestan|vale|valen|sale|salen|costo|coste|price|costs?)\b[^.\n]{0,30}\d`, "iu"),
  discount: /\d+(?:[.,]\d+)?\s?%|\b(?:descuento|discount|rebaja)\b/iu,
  stock: /\b(?:stock|existencias?|en existencia|disponibles?|quedan|unidades|in stock|available|agotad[oa]s?)\b/iu,
  lead_time: /\b\d+\s?(?:-\s?\d+\s?)?(?:d[ií]as?|semanas?|horas?|hs|h|meses|mes|days?|weeks?|hours?|months?)\b|\b(?:plazo|entrega en|demora|delivery|lead time)\b/iu,
};

/** True if the text looks like it states a price, discount, stock or lead time. */
export function looksFactual(text: string): boolean {
  return Object.values(FACTUAL_PATTERNS).some((re) => re.test(text));
}

function validlyCited(citations: ReadonlyArray<{ chunkId: string }>, valid: ReadonlySet<string>): boolean {
  return citations.length > 0 && citations.every((cit) => valid.has(cit.chunkId));
}

function hasUncitedFactualClaim(output: AiTurnOutput, valid: ReadonlySet<string>): boolean {
  const reply = output.reply;
  if (!reply) return false;
  const claims = reply.claims ?? [];
  // 1. Declared factual claims, or `other` claims whose text looks factual, need valid citations.
  const badClaim = claims.some(
    (c) => (FACTUAL_CLAIM_KINDS.includes(c.kind) || looksFactual(c.text)) && !validlyCited(c.citations, valid),
  );
  if (badClaim) return true;
  // 2. Factual-looking reply text must be backed by at least one validly cited claim.
  if (looksFactual(reply.text)) return !claims.some((c) => validlyCited(c.citations, valid));
  return false;
}

/**
 * Pure policy engine (ADR 0003). The model proposes; this decides what may run
 * automatically, what needs a human, and what is refused.
 */
export function evaluateTurn(output: AiTurnOutput, ctx: AiPolicyContext): TurnEvaluation {
  const mode = ctx.mode ?? "auto";
  const actions = (Array.isArray(output.actions) ? output.actions : []).map((a: unknown) => evaluateAction(a, ctx));
  let reply: TurnEvaluation["reply"];
  let needsHandoff = false;

  if (!output.reply) {
    reply = { allowed: false, reason: "no reply proposed" };
  } else if (hasUncitedFactualClaim(output, ctx.validChunkIds)) {
    reply = { allowed: false, reason: "factual claim without valid citation" };
    needsHandoff = true;
  } else if (!isValidConfidence(output.confidence) || output.confidence < ctx.confidenceThreshold) {
    reply =
      mode === "assist"
        ? { allowed: true, draft: true, reason: "low confidence; draft for human review" }
        : { allowed: false, reason: "confidence below threshold" };
    needsHandoff = mode === "auto";
  } else if (output.needsHuman === true) {
    reply =
      mode === "assist"
        ? { allowed: true, draft: true, reason: "model requested a human; draft only" }
        : { allowed: false, reason: "model requested a human" };
    needsHandoff = mode === "auto";
  } else {
    reply = mode === "assist" ? { allowed: true, draft: true, reason: "assist mode draft" } : { allowed: true, reason: "ok" };
  }

  if (needsHandoff && !actions.some((a) => a.decision !== "deny" && (a.action as AiAction).type === "handoff")) {
    actions.push({
      action: { type: "handoff", reason: reply.reason },
      decision: "auto",
      reason: "added by policy engine",
    });
  }
  return { reply, actions };
}
