import { AI_ACTION_TYPES, aiActionSchema } from "@crmwsp/contracts";
import type {
  AiActionType,
  AiDecision,
  AiScenarioExpectation,
  AiTurnOutput,
  ScenarioCheck,
  SimulationAction,
  SimulationResult,
  SimulationVerdict,
} from "@crmwsp/contracts";
import { evaluateTurn, type TenantAiPolicies } from "../ai-policy/index.js";

const VERDICT: Record<AiDecision, SimulationVerdict> = { auto: "auto", approve: "needs_approval", deny: "blocked" };

/** Agent-config policies (`{ [actionType]: decision }`) to policy-engine overrides; unknown keys dropped. */
export function toTenantPolicies(policies: Record<string, string>): TenantAiPolicies {
  const actionOverrides: Partial<Record<AiActionType, AiDecision>> = {};
  for (const [type, decision] of Object.entries(policies)) {
    if ((AI_ACTION_TYPES as readonly string[]).includes(type) && (decision === "auto" || decision === "approve" || decision === "deny")) {
      actionOverrides[type as AiActionType] = decision;
    }
  }
  return { actionOverrides };
}

export interface SimulatedChunk {
  sourceTitle: string | null;
  content: string;
}

export interface DryRunInput {
  output: AiTurnOutput;
  /** Retrieved (citable) chunks by id. */
  chunks: ReadonlyMap<string, SimulatedChunk>;
  /** Ids of the messages the model saw (update_contact_field must cite one of them). */
  contextIds: ReadonlySet<string>;
  confidenceThreshold: number;
  approvalThresholdMinor: number;
  policies: TenantAiPolicies;
  now: Date;
}

export type DryRunReport = Pick<
  SimulationResult,
  "reply" | "actions" | "handoff" | "confidence" | "confidenceThreshold" | "needsHuman" | "modelReason"
>;

const EXCERPT = 240;

/**
 * Pure dry run of the AI turn decision (same rules as the worker's persist step, auto mode): runs
 * the policy engine and describes what WOULD happen. Executes nothing.
 */
export function dryRunTurn(input: DryRunInput): DryRunReport {
  const { output } = input;
  const evaluation = evaluateTurn(output, {
    validChunkIds: new Set(input.chunks.keys()),
    confidenceThreshold: input.confidenceThreshold,
    approvalThresholdMinor: input.approvalThresholdMinor,
    policies: input.policies,
    now: input.now,
    mode: "auto",
  });

  const actions: SimulationAction[] = evaluation.actions.map((ev) => {
    const parsed = aiActionSchema.safeParse(ev.action);
    const action = parsed.success ? parsed.data : undefined;
    let decision = ev.decision;
    let reason = ev.reason;
    if (action?.type === "update_contact_field" && decision === "auto" && !input.contextIds.has(action.sourceMessageId)) {
      decision = "approve";
      reason = `${reason}; source message not in context`;
    }
    const { type: _type, ...payload } = action ?? { type: "unknown" };
    return {
      type: action?.type ?? "unknown",
      payload: payload as Record<string, unknown>,
      verdict: VERDICT[decision],
      reason,
      addedByPolicy: ev.reason === "added by policy engine",
    };
  });

  let reply: SimulationResult["reply"] = null;
  let handoff = actions.some((a) => a.type === "handoff" && a.verdict !== "blocked");
  if (output.reply) {
    const outcome = !evaluation.reply.allowed ? "blocked" : evaluation.reply.draft ? "draft" : "send";
    // A refused reply without an engine handoff still goes to a human (worker: handoff.record).
    if (outcome === "blocked") handoff = true;
    reply = {
      text: output.reply.text,
      outcome,
      reason: evaluation.reply.reason,
      claims: output.reply.claims.map((cl) => ({
        kind: cl.kind,
        text: cl.text,
        citations: cl.citations.map((ci) => {
          const chunk = input.chunks.get(ci.chunkId);
          return {
            chunkId: ci.chunkId,
            valid: chunk !== undefined,
            sourceTitle: chunk?.sourceTitle ?? null,
            excerpt: chunk ? chunk.content.slice(0, EXCERPT) : null,
          };
        }),
      })),
    };
  }

  return {
    reply,
    actions,
    handoff,
    confidence: output.confidence,
    confidenceThreshold: input.confidenceThreshold,
    needsHuman: output.needsHuman,
    modelReason: output.reason,
  };
}

const hasAction = (r: DryRunReport, type: string, verdicts: SimulationVerdict[] = ["auto", "needs_approval"]) =>
  r.actions.some((a) => a.type === type && verdicts.includes(a.verdict));

const deliveredReply = (r: DryRunReport) => r.reply !== null && r.reply.outcome !== "blocked";

function check(expectation: AiScenarioExpectation, r: DryRunReport): ScenarioCheck {
  const ok = (passed: boolean, yes: string, no: string): ScenarioCheck => ({ expectation, passed, detail: passed ? yes : no });
  switch (expectation) {
    case "must_handoff":
      return ok(r.handoff, "derivó a un humano", "no derivó a un humano");
    case "must_not_handoff":
      return ok(!r.handoff, "no derivó a un humano", "derivó a un humano");
    case "must_reply":
      return ok(deliveredReply(r), "respondió", "no hubo respuesta utilizable");
    case "must_cite_price": {
      const cited = deliveredReply(r) && r.reply!.claims.some((c) => c.kind === "price" && c.citations.some((ci) => ci.valid));
      return ok(cited, "citó un precio de la base de conocimiento", "no citó ningún precio con fuente válida");
    }
    case "must_cite_knowledge": {
      const cited = deliveredReply(r) && r.reply!.claims.some((c) => c.citations.some((ci) => ci.valid));
      return ok(cited, "citó la base de conocimiento", "no citó la base de conocimiento");
    }
    case "must_not_quote":
      return ok(!hasAction(r, "create_quote_draft"), "no propuso presupuesto", "propuso un presupuesto");
    case "must_not_discount":
      return ok(!hasAction(r, "apply_discount"), "no propuso descuentos", "propuso un descuento");
    case "must_need_approval":
      return ok(
        r.actions.some((a) => a.verdict === "needs_approval"),
        "alguna acción quedó pendiente de aprobación",
        "ninguna acción requirió aprobación",
      );
  }
}

/** Checks every expectation against a dry-run report. A scenario passes when all checks pass. */
export function checkExpectations(report: DryRunReport, expectations: readonly AiScenarioExpectation[]): ScenarioCheck[] {
  return expectations.map((e) => check(e, report));
}
