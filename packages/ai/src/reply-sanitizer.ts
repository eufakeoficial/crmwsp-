import type { AiTurnOutput } from "@crmwsp/contracts";

/*
 * Deterministic last line of defence for customer-facing reply text. Citations belong in
 * `claims[].citations`; the model sometimes leaks them into the text anyway
 * ("(chunkId: 47035704-…)", "[1]", bare chunk UUIDs). Those are internal ids and must never
 * reach the customer, whatever the prompt said.
 *
 * Every quantifier is bounded and no pattern starts with an unbounded `\s*`, so matching stays
 * linear on long or adversarial texts.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

// Explicit chunk references, with or without brackets, optionally after "fuente:"/"source:".
const BRACKETED_CHUNK =
  /[ \t]{0,3}[([{][ \t]{0,3}(?:(?:fuentes?|sources?|citations?|cita)[ \t]{0,3}[:=][ \t]{0,3})?chunk(?:[ \t_-]?ids?|s)?\b[^)\]}\n]{0,80}[)\]}]/giu;
const BARE_CHUNK = /[ \t]{0,3}\bchunk[ \t_-]?ids?[ \t]{0,3}[:=][ \t]{0,3}[\w-]{1,64}/giu;
// "[1]", "[2, 3]", "【1】" glued to the preceding text (a citation), never at the start of a line
// (an enumeration). Only numbers that match a retrieved chunk (1..chunkCount) count.
const NUMERIC_MARKER = /(?<=[^\s[【])[ \t]?[[【][ \t]?(\d{1,2}(?:[ \t]?[,;][ \t]?\d{1,2}){0,5})[ \t]?[\]】]/gu;

export interface SanitizeContext {
  /** Ids of the chunks the model saw; only these UUIDs are stripped when bare. */
  chunkIds?: readonly string[];
}

/** Removes chunk ids and citation markers from reply text; tidies the whitespace left behind. */
export function sanitizeReplyText(text: string, ctx: SanitizeContext = {}): string {
  const known = new Set((ctx.chunkIds ?? []).map((id) => id.toLowerCase()));
  const chunkCount = ctx.chunkIds?.length ?? 0;
  let out = text.replace(BRACKETED_CHUNK, "").replace(BARE_CHUNK, "");
  if (known.size > 0) {
    out = out.replace(UUID_RE, (m) => (known.has(m.toLowerCase()) ? "" : m));
    out = out.replace(NUMERIC_MARKER, (m, nums: string) =>
      nums.split(/[,;]/).every((n) => {
        const k = Number(n.trim());
        return k >= 1 && k <= chunkCount;
      })
        ? ""
        : m,
    );
  }
  return out
    .replace(/\([ \t]{0,3}\)|\[[ \t]{0,3}\]/g, "")
    .replace(/[ \t]{1,8}([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]{1,16}$/gm, "")
    .trim();
}

/**
 * Sanitizes the reply of a parsed turn. When nothing is left the reply is removed and
 * `replyDropped` is set, so the policy engine escalates to a human instead of going silent.
 */
export function sanitizeTurnReply(output: AiTurnOutput, ctx: SanitizeContext = {}): AiTurnOutput {
  if (!output.reply) return output;
  const text = sanitizeReplyText(output.reply.text, ctx);
  if (text === output.reply.text) return output;
  if (text === "") {
    const { reply: _reply, ...rest } = output;
    return { ...rest, replyDropped: true };
  }
  return { ...output, reply: { ...output.reply, text } };
}
