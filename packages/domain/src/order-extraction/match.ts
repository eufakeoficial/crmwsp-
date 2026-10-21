import { computeLineBreakdown, sumLines, type LineBreakdown } from "../orders/money.js";
import { normalizeText, unitFactor } from "./units.js";

/**
 * Matching of extracted order lines to the tenant catalog (F4). Pure: the caller loads the active
 * catalog (RLS-scoped) and passes it in. Prices come ONLY from the catalog candidates; a line that
 * cannot be priced from the catalog is never priced at all, it is flagged `dudoso`.
 */

export interface CatalogCandidate {
  productId: string;
  variantId: string | null;
  productVersion: number;
  /** Display label, e.g. "Camisa (M / Negro)". */
  label: string;
  /** Extra searchable text (product name, variant option values). */
  searchText: string;
  sku: string | null;
  unit: string | null;
  priceMinor: bigint;
  currency: string;
  taxRateBp: number;
}

export interface OrderLineInput {
  rawText: string;
  quantity: number | null;
  unit: string | null;
  productGuess: string;
}

export type DudosoReason = "no_match" | "ambiguous" | "low_confidence" | "no_quantity" | "unit_mismatch" | "currency_mismatch";

export interface MatchedRef {
  productId: string;
  variantId: string | null;
  productVersion: number;
  label: string;
  unit: string;
  unitPriceMinor: bigint;
  currency: string;
  taxRateBp: number;
}

export interface Alternative {
  productId: string;
  variantId: string | null;
  label: string;
  score: number;
}

export interface MatchedLine {
  input: OrderLineInput;
  status: "matched" | "dudoso";
  reason: DudosoReason | null;
  /** 0..1 similarity of the best candidate. */
  confidence: number;
  match: MatchedRef | null;
  /** Quantity in the CATALOG unit x 1000; null when unknown or not convertible. */
  quantityMilli: bigint | null;
  alternatives: Alternative[];
}

export const MATCH_MIN_SCORE = 0.6;
export const AMBIGUITY_MARGIN = 0.08;
export const MAX_ALTERNATIVES = 3;
export const MAX_QUANTITY_MILLI = 1_000_000_000n;

const STOPWORDS = new Set(["de", "del", "el", "la", "los", "las", "y", "con", "para", "un", "una", "unos", "unas", "por", "favor", "al"]);

export function tokens(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "" && !STOPWORDS.has(t));
}

/** pg_trgm-style trigram set of a string (each word padded with two leading and one trailing space). */
export function trigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (const w of tokens(s)) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) out.add(p.slice(i, i + 3));
  }
  return out;
}

export function trigramSimilarity(a: string, b: string): number {
  const ta = trigrams(a);
  const tb = trigrams(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * Token coverage: every word of the guess found in the candidate scores high; extra candidate
 * words lower it a little. Single letters/numbers ("modelo B") must match exactly.
 */
export function tokenScore(guess: string, candidate: string): number {
  const g = tokens(guess);
  const c = new Set(tokens(candidate));
  if (g.length === 0 || c.size === 0) return 0;
  const hit = g.filter((t) => c.has(t)).length;
  return (hit / g.length) * (0.6 + 0.4 * (hit / c.size));
}

export function candidateScore(guess: string, c: CatalogCandidate): number {
  const ng = normalizeText(guess).replace(/\s+/g, "");
  if (c.sku && ng !== "" && normalizeText(c.sku).replace(/\s+/g, "") === ng) return 1;
  if (c.sku && tokens(guess).includes(normalizeText(c.sku))) return 0.95;
  const text = `${c.label} ${c.searchText}`;
  return Math.max(trigramSimilarity(guess, c.label), tokenScore(guess, c.label), tokenScore(guess, text) * 0.95);
}

function ref(c: CatalogCandidate): MatchedRef {
  return {
    productId: c.productId,
    variantId: c.variantId,
    productVersion: c.productVersion,
    label: c.label,
    unit: c.unit ?? "ud",
    unitPriceMinor: c.priceMinor,
    currency: c.currency,
    taxRateBp: c.taxRateBp,
  };
}

function toMilli(quantity: number, factor: number): bigint | null {
  const milli = Math.round(quantity * factor * 1000);
  if (!Number.isSafeInteger(milli) || milli < 1) return null;
  const v = BigInt(milli);
  return v > MAX_QUANTITY_MILLI ? null : v;
}

/** Matches one line against the catalog. `currency`: the quote currency, when already fixed. */
export function matchLine(input: OrderLineInput, catalog: readonly CatalogCandidate[], currency?: string): MatchedLine {
  const scored = catalog
    .map((c) => ({ c, score: candidateScore(input.productGuess, c) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.c.label.localeCompare(b.c.label));
  const alternatives = scored.slice(0, MAX_ALTERNATIVES).map((s) => ({
    productId: s.c.productId,
    variantId: s.c.variantId,
    label: s.c.label,
    score: Math.round(s.score * 1000) / 1000,
  }));
  const best = scored[0];
  const base = { input, alternatives, confidence: best ? Math.round(best.score * 1000) / 1000 : 0 };
  if (!best || best.score < 0.3) return { ...base, status: "dudoso", reason: "no_match", match: null, quantityMilli: null };
  if (best.score < MATCH_MIN_SCORE) return { ...base, status: "dudoso", reason: "low_confidence", match: null, quantityMilli: null };
  const second = scored[1];
  if (second && best.score - second.score < AMBIGUITY_MARGIN && best.score < 1) {
    return { ...base, status: "dudoso", reason: "ambiguous", match: null, quantityMilli: null };
  }
  return resolveQuantity(input, best.c, base.confidence, alternatives, currency);
}

/** Quantity/unit/currency checks for a chosen candidate (also used when a human picks a match). */
export function resolveQuantity(
  input: OrderLineInput,
  c: CatalogCandidate,
  confidence: number,
  alternatives: Alternative[],
  currency?: string,
): MatchedLine {
  const match = ref(c);
  const common = { input, confidence, match, alternatives };
  if (currency !== undefined && c.currency !== currency) return { ...common, status: "dudoso", reason: "currency_mismatch", quantityMilli: null };
  if (input.quantity === null) return { ...common, status: "dudoso", reason: "no_quantity", quantityMilli: null };
  const factor = unitFactor(input.unit, c.unit);
  if (factor === null) return { ...common, status: "dudoso", reason: "unit_mismatch", quantityMilli: null };
  const quantityMilli = toMilli(input.quantity, factor);
  if (quantityMilli === null) return { ...common, status: "dudoso", reason: "no_quantity", quantityMilli: null };
  return { ...common, status: "matched", reason: null, quantityMilli };
}

/**
 * Matches all lines. The quote currency is the currency of the first confident match; later lines
 * priced in another currency are flagged (a quote has one currency).
 */
export function matchOrderLines(lines: readonly OrderLineInput[], catalog: readonly CatalogCandidate[]): { lines: MatchedLine[]; currency: string | null } {
  let currency: string | undefined;
  const out: MatchedLine[] = [];
  for (const l of lines) {
    const m = matchLine(l, catalog, currency);
    if (m.status === "matched" && m.match && currency === undefined) currency = m.match.currency;
    out.push(m);
  }
  return { lines: out, currency: currency ?? null };
}

export interface DraftLine {
  productId: string;
  variantId: string | null;
  productVersion: number;
  description: string;
  quantityMilli: bigint;
  unit: string;
  unitPriceMinor: bigint;
  taxRateBp: number;
  breakdown: LineBreakdown;
}

/** Quote draft lines (catalog prices only) from the matched lines; dudosos are left out. */
export function draftLines(lines: readonly MatchedLine[]): { lines: DraftLine[]; totals: ReturnType<typeof sumLines> } {
  const out: DraftLine[] = [];
  for (const l of lines) {
    if (l.status !== "matched" || !l.match || l.quantityMilli === null) continue;
    out.push({
      productId: l.match.productId,
      variantId: l.match.variantId,
      productVersion: l.match.productVersion,
      description: l.match.label,
      quantityMilli: l.quantityMilli,
      unit: l.match.unit,
      unitPriceMinor: l.match.unitPriceMinor,
      taxRateBp: l.match.taxRateBp,
      breakdown: computeLineBreakdown(l.quantityMilli, l.match.unitPriceMinor, 0, l.match.taxRateBp),
    });
  }
  return { lines: out, totals: sumLines(out.map((l) => l.breakdown)) };
}

const fmtQty = (milli: bigint): string => {
  const whole = milli / 1000n;
  const frac = milli % 1000n;
  return frac === 0n ? whole.toString() : (Number(milli) / 1000).toString();
};

/** Question for one dudoso line, in Spanish (customer-facing). Never mentions prices. */
export function dudosoQuestion(l: MatchedLine): string {
  const g = l.input.productGuess;
  switch (l.reason) {
    case "ambiguous": {
      const top = l.alternatives[0]?.score ?? 0;
      const labels = l.alternatives.filter((a) => top - a.score < AMBIGUITY_MARGIN).map((a) => a.label);
      const opts = labels.length <= 1 ? labels.join("") : `${labels.slice(0, -1).join(", ")} o ${labels[labels.length - 1]}`;
      return `¿El «${g}» es ${opts}?`;
    }
    case "low_confidence":
      return l.alternatives[0] ? `¿Con «${g}» te referís a ${l.alternatives[0].label}?` : `No encontramos «${g}» en el catálogo, ¿nos indicás el nombre o código?`;
    case "no_quantity":
      return `¿Cuántas unidades de ${l.match?.label ?? `«${g}»`} necesitás?`;
    case "unit_mismatch":
      return `${l.match?.label ?? g} se vende por ${l.match?.unit ?? "unidad"}: ¿cuántas ${l.match?.unit ?? "unidades"} serían para «${l.input.rawText || g}»?`;
    case "currency_mismatch":
      return `${l.match?.label ?? g} lo revisará un asesor.`;
    default:
      return `No encontramos «${g}» en el catálogo, ¿nos indicás el nombre o código?`;
  }
}

/**
 * Customer reply summarizing the detected order and asking about the dudosos. Prices are never
 * stated here: the quote (catalog prices, reviewed by a human) carries them.
 */
export function buildOrderConfirmationReply(lines: readonly MatchedLine[]): string {
  const ok = lines.filter((l) => l.status === "matched" && l.match && l.quantityMilli !== null);
  const doubts = lines.filter((l) => l.status === "dudoso");
  const parts: string[] = [];
  if (ok.length > 0) {
    parts.push("¡Gracias! Anotamos tu pedido:");
    for (const l of ok) parts.push(`• ${fmtQty(l.quantityMilli as bigint)} ${l.match!.unit} — ${l.match!.label}`);
  } else {
    parts.push("¡Gracias por tu pedido!");
  }
  if (doubts.length > 0) {
    parts.push("", "Para completarlo necesitamos confirmar:");
    for (const l of doubts) parts.push(`• ${dudosoQuestion(l)}`);
  }
  parts.push("", "En cuanto lo confirmemos te enviamos el presupuesto.");
  return parts.join("\n");
}

const QTY_RE = /\b(\d+(?:[.,]\d+)?|una?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cincuenta|cien|media)\s+(?:[a-záéíóúñ]+\s+){0,3}?[a-záéíóúñ]{2,}/gi;
const ORDER_VERB_RE = /\b(quiero|quisiera|necesito|necesitamos|mand[aá]me|mand[aá]nos|env[ií]ame|env[ií]anos|pedido|pido|ped[ií]|encargo|cotiz|presupuest|me (?:das|pas[aá]s|traes)|anot[aá]me|comprar)/i;

/** Cheap gate for voice notes: only transcripts that look like a purchase request go to extraction. */
export function looksLikeOrder(text: string): boolean {
  const t = text.trim();
  if (t === "") return false;
  const qty = t.match(QTY_RE)?.length ?? 0;
  if (qty === 0) return false;
  return ORDER_VERB_RE.test(t) || qty >= 2;
}
