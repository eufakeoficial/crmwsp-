import { createHash } from "node:crypto";
import { formatMinor } from "./price.js";
import type { CatalogRow, Chunk, ChunkInput } from "./types.js";

/** ~4 chars per token: 800 tokens ~ 3200 chars, 100 tokens ~ 400 chars. */
export const CHUNK_MAX_CHARS = 3200;
export const CHUNK_OVERLAP_CHARS = 400;

export function catalogRowText(r: CatalogRow): string {
  const parts = [`${r.name} — ${formatMinor(r.price_minor, r.currency)} ${r.currency}${r.unit ? ` por ${r.unit}` : ""}.`];
  if (r.sku) parts.push(`SKU ${r.sku}.`);
  if (r.stock !== undefined) parts.push(`Stock: ${r.stock}.`);
  if (r.lead_time) parts.push(`Plazo: ${r.lead_time}.`);
  if (r.description) parts.push(r.description.endsWith(".") ? r.description : `${r.description}.`);
  return parts.join(" ");
}

function splitLong(unit: string, max: number): string[] {
  if (unit.length <= max) return [unit];
  const out: string[] = [];
  let rest = unit;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"));
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut < max / 2) cut = max - 1;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) out.push(piece);
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

function overlapTail(content: string, size: number): string {
  if (content.length <= size) return content;
  let tail = content.slice(content.length - size);
  const sp = tail.search(/\s/);
  if (sp >= 0) tail = tail.slice(sp + 1);
  return tail.trim();
}

/** Paragraph-respecting splitter with character overlap between consecutive chunks. */
export function splitText(
  text: string,
  maxChars = CHUNK_MAX_CHARS,
  overlap = CHUNK_OVERLAP_CHARS,
): string[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (!normalized) return [];
  const units = normalized
    .split(/\n[^\S\n]*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .flatMap((p) => splitLong(p, maxChars - overlap));

  const chunks: string[] = [];
  let current = "";
  let fresh = true; // true when `current` holds only overlap from the previous chunk
  for (const u of units) {
    const candidate = current ? `${current}\n\n${u}` : u;
    if (candidate.length <= maxChars) {
      current = candidate;
      fresh = false;
      continue;
    }
    if (!fresh) chunks.push(current);
    const prev = fresh ? "" : current;
    current = prev ? `${overlapTail(prev, overlap)}\n\n${u}` : u;
    if (current.length > maxChars) current = u;
    fresh = false;
  }
  if (!fresh && current) chunks.push(current);
  return chunks.filter((c) => c.trim() !== "");
}

export function chunkDocument(input: ChunkInput): Chunk[] {
  switch (input.kind) {
    case "catalog":
      return input.rows.map((r, ordinal) => ({
        ordinal,
        content: catalogRowText(r),
        metadata: {
          kind: "catalog_item",
          name: r.name,
          price_minor: r.price_minor,
          currency: r.currency,
          ...(r.sku !== undefined && { sku: r.sku }),
          ...(r.unit !== undefined && { unit: r.unit }),
          ...(r.stock !== undefined && { stock: r.stock }),
          ...(r.lead_time !== undefined && { lead_time: r.lead_time }),
        },
      }));
    case "faq":
      return input.pairs.map((p, ordinal) => ({
        ordinal,
        content: `P: ${p.question}\nR: ${p.answer}`,
        metadata: { kind: "faq", question: p.question },
      }));
    case "pdf":
    case "text":
      return splitText(input.text).map((content, ordinal) => ({
        ordinal,
        content,
        metadata: { kind: input.kind },
      }));
  }
}

const nl = (s: string): string => s.replace(/\r\n?/g, "\n");

/** sha256 of the canonical source content, to skip re-indexing unchanged sources. */
export function contentHash(input: ChunkInput | string): string {
  const canonical =
    typeof input === "string"
      ? input
      : input.kind === "catalog"
        ? JSON.stringify(input.rows.map(({ line: _line, ...rest }) => rest), (_k, v: unknown) => (typeof v === "string" ? nl(v) : v))
        : input.kind === "faq"
          ? JSON.stringify(input.pairs.map((p) => ({ question: nl(p.question), answer: nl(p.answer) })))
          : input.text;
  return createHash("sha256").update(nl(canonical)).digest("hex");
}
