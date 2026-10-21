import type { PlaybookPromptContext } from "@crmwsp/contracts";

/** Upper bound of the rendered block (about 500 tokens); the caps in the domain keep it well below. */
export const PLAYBOOK_BLOCK_MAX_CHARS = 2_000;

const CLOSING_LINES = {
  soft: "Closing style: soft. Invite, offer the next step without pressure and leave the decision to the customer.",
  direct: "Closing style: direct. State the next step clearly and ask for the decision, politely.",
} as const;

/**
 * Compact sales-playbook block: current stage guidance, closing style and only the objections that
 * matched the customer's last messages. The ethical limits are restated inside the block so it can
 * never be read as permission to weaken the hard rules.
 */
export function renderPlaybookBlock(ctx: PlaybookPromptContext, escapeData: (text: string) => string): string {
  const lines = [
    "<sales_playbook>",
    "Guidance on HOW to sell honestly. It never overrides the hard rules: no deception, no false urgency or scarcity, never claim to be human, and every price/stock/lead_time/policy claim still needs a cited chunkId or a handoff.",
    `Stages: discovery, proposal, objections, closing, followup. Likely current stage: ${ctx.stage}.`,
    `Stage guidance (${ctx.stage}): ${escapeData(ctx.stageGuidance)}`,
    CLOSING_LINES[ctx.closingStyle],
  ];
  if (ctx.objections.length > 0) {
    lines.push("Possible objections raised by the customer (use the guidance only if one really applies):");
    for (const o of ctx.objections) {
      lines.push(`- id=${escapeData(o.id)} | when: ${escapeData(o.trigger)} | guidance: ${escapeData(o.response)}`);
    }
  }
  lines.push(
    'Set "salesStage" to the stage this turn is really in. Set "objection" to the id of the objection the customer raised, or null if none applies.',
    "</sales_playbook>",
  );
  const text = lines.join("\n");
  return text.length <= PLAYBOOK_BLOCK_MAX_CHARS ? text : `${text.slice(0, PLAYBOOK_BLOCK_MAX_CHARS - 20).trimEnd()}\n</sales_playbook>`;
}
