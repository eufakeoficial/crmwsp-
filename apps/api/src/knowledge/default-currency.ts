import { detectMapping } from "@crmwsp/knowledge";

/** Same delimiter rule as @crmwsp/knowledge: most frequent of `,` `;` tab in the first unquoted line. */
function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (ch === "\n") break;
      if (ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
    }
  }
  let best = ",";
  for (const d of [",", ";", "\t"]) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d;
  return best;
}

function splitLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === delim && !inQuotes) {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

/**
 * Catalog CSVs without any currency column get the tenant's default currency as an extra column.
 * Only the raw text of each record is extended (no re-serialization), so line numbers in parse
 * errors still match the original file. Files that already have a currency column are untouched,
 * and rows that contradict the default (e.g. "Bs 400" with default EUR) still fail as a mismatch.
 */
export function withDefaultCurrency(text: string, currency: string): string {
  const bom = text.charCodeAt(0) === 0xfeff ? "\uFEFF" : "";
  const src = bom ? text.slice(1) : text;
  const delim = detectDelimiter(src);

  const segments: Array<{ body: string; eol: string }> = [];
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string;
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      const eol = ch === "\r" && src[i + 1] === "\n" ? "\r\n" : ch;
      segments.push({ body: src.slice(start, i), eol });
      i += eol.length - 1;
      start = i + 1;
    }
  }
  segments.push({ body: src.slice(start), eol: "" });

  const headerIdx = segments.findIndex((s) => s.body.trim() !== "");
  if (headerIdx < 0) return text;
  const headers = splitLine((segments[headerIdx] as { body: string }).body, delim);
  if (detectMapping(headers).currency !== undefined) return text;

  const out = segments.map((s, i) => {
    if (s.body.trim() === "") return s.body + s.eol;
    return `${s.body}${delim}${i === headerIdx ? "currency" : currency}${s.eol}`;
  });
  return bom + out.join("");
}
