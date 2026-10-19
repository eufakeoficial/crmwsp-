import type { Contact } from "@crmwsp/contracts";

export interface ExtractedRow {
  key: string;
  value: string;
  /** Rounded percentage, when a valid 0..1 confidence comes with the field. */
  confidence: number | null;
}

const MAX_VALUE_CHARS = 200;

function toText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value || "—";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const json = JSON.stringify(value);
    return json === undefined ? "—" : json;
  } catch {
    return "—";
  }
}

/**
 * Flattens `contact.extracted` into plain-text rows. Tolerant of free-form jsonb: an entry that
 * is not `{ value, confidence? }` is shown as its own value without confidence.
 */
export function extractedRows(extracted: Contact["extracted"] | null | undefined): ExtractedRow[] {
  if (!extracted || typeof extracted !== "object") return [];
  return Object.entries(extracted).map(([key, raw]) => {
    const isField = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "value" in raw;
    const value = isField ? (raw as { value: unknown }).value : raw;
    const conf = isField ? (raw as { confidence?: unknown }).confidence : undefined;
    const text = toText(value);
    return {
      key,
      value: text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text,
      confidence: typeof conf === "number" && Number.isFinite(conf) && conf >= 0 && conf <= 1 ? Math.round(conf * 100) : null,
    };
  });
}
