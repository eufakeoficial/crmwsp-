import type { ConflictEntry, PriceConflict, SourcedCatalogRow } from "./types.js";

export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const entryOf = (r: SourcedCatalogRow): ConflictEntry => ({
  source: r.source,
  line: r.line,
  name: r.name,
  price_minor: r.price_minor,
  currency: r.currency,
  ...(r.sku !== undefined && { sku: r.sku }),
});

function group(rows: SourcedCatalogRow[], keyOf: (r: SourcedCatalogRow) => string | null) {
  const map = new Map<string, SourcedCatalogRow[]>();
  for (const r of rows) {
    const k = keyOf(r);
    if (!k) continue;
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return map;
}

function isConflict(g: SourcedCatalogRow[]): boolean {
  const prices = new Set(g.map((r) => `${r.price_minor}|${r.currency}`));
  return prices.size > 1;
}

const reasonOf = (g: SourcedCatalogRow[]): PriceConflict["reason"] =>
  new Set(g.map((r) => r.source)).size > 1 ? "cross_source" : "duplicate_in_source";

/** Same SKU or normalized name with different prices, across sources or duplicated within one source. */
export function detectConflicts(rows: SourcedCatalogRow[]): PriceConflict[] {
  const out: PriceConflict[] = [];
  const covered = new Set<SourcedCatalogRow>();
  for (const [key, g] of group(rows, (r) => (r.sku ? r.sku.trim().toUpperCase() : null))) {
    if (!isConflict(g)) continue;
    out.push({ matchedBy: "sku", reason: reasonOf(g), key, entries: g.map(entryOf) });
    g.forEach((r) => covered.add(r));
  }
  for (const [key, g] of group(rows, (r) => normalizeName(r.name) || null)) {
    if (!isConflict(g) || g.every((r) => covered.has(r))) continue;
    out.push({ matchedBy: "name", reason: reasonOf(g), key, entries: g.map(entryOf) });
  }
  return out;
}
