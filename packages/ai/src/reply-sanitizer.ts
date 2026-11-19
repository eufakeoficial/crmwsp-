/*
 * Deterministic last line of defence for customer-facing reply text. Citations belong in
 * `claims[].citations`; the model sometimes leaks them into the text anyway
 * ("(chunkId: 47035704-…)", "[1]", bare UUIDs). Those are internal ids and must never reach
 * the customer, whatever the prompt said.
 */

const UUID = String.raw`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`;

const PATTERNS: RegExp[] = [
  // "(chunkId: <id>)", "[chunk_id=<id>]", "(fuente: chunk 3)", with any bracket style.
  new RegExp(String.raw`\s*[([{]\s*(?:chunk[\s_-]?ids?|chunks?)\b\s*[:=#]?\s*[^)\]}\n]*[)\]}]`, "giu"),
  new RegExp(String.raw`\s*[([{]\s*(?:fuentes?|sources?|citations?|ref)\s*[:=#]\s*[^)\]}\n]*[)\]}]`, "giu"),
  // Unbracketed "chunkId: <id>" / "chunkId=<id>".
  new RegExp(String.raw`\s*\bchunk[\s_-]?ids?\s*[:=]\s*(?:${UUID}|[\w-]+)`, "giu"),
  // Bare UUIDs anywhere.
  new RegExp(String.raw`\s*\b${UUID}\b`, "giu"),
  // Numeric reference markers: [1], [2,3], [1][2], 【1】.
  /\s*[[【]\s*\d+(?:\s*[,;-]\s*\d+)*\s*[\]】]/gu,
];

/** Removes chunk ids, UUIDs and citation markers from reply text; tidies the whitespace left behind. */
export function sanitizeReplyText(text: string): string {
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, "");
  return out
    .replace(/\(\s*\)|\[\s*\]/g, "")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
