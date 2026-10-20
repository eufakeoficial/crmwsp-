/**
 * Unit normalization and conversion for order lines (F4). Pure. A conversion only exists inside one
 * dimension (count, mass, volume, length); container units (caja, paquete...) only convert to
 * themselves because their content size is product-specific and unknown here.
 */

export type UnitDimension = "count" | "mass" | "volume" | "length" | "container";

interface UnitDef {
  canonical: string;
  dimension: UnitDimension;
  /** Factor to the dimension base (count: ud, mass: g, volume: ml, length: cm). */
  factor: number;
}

const DEFS: Array<[string[], UnitDef]> = [
  [["ud", "uds", "u", "un", "unidad", "unidades", "unid", "pieza", "piezas", "pz", "pza", "pzas", "unit", "units"], { canonical: "ud", dimension: "count", factor: 1 }],
  [["docena", "docenas", "dz", "doc"], { canonical: "docena", dimension: "count", factor: 12 }],
  [["par", "pares"], { canonical: "par", dimension: "count", factor: 2 }],
  [["kg", "kgs", "kilo", "kilos", "kilogramo", "kilogramos"], { canonical: "kg", dimension: "mass", factor: 1000 }],
  [["g", "gr", "grs", "gramo", "gramos"], { canonical: "g", dimension: "mass", factor: 1 }],
  [["l", "lt", "lts", "litro", "litros"], { canonical: "l", dimension: "volume", factor: 1000 }],
  [["ml", "mililitro", "mililitros", "cc"], { canonical: "ml", dimension: "volume", factor: 1 }],
  [["m", "mt", "mts", "metro", "metros"], { canonical: "m", dimension: "length", factor: 100 }],
  [["cm", "centimetro", "centimetros"], { canonical: "cm", dimension: "length", factor: 1 }],
  [["caja", "cajas", "cj", "cja"], { canonical: "caja", dimension: "container", factor: 1 }],
  [["paquete", "paquetes", "paq", "pack", "packs"], { canonical: "paquete", dimension: "container", factor: 1 }],
  [["bolsa", "bolsas"], { canonical: "bolsa", dimension: "container", factor: 1 }],
  [["bulto", "bultos"], { canonical: "bulto", dimension: "container", factor: 1 }],
  [["rollo", "rollos"], { canonical: "rollo", dimension: "container", factor: 1 }],
  [["botella", "botellas"], { canonical: "botella", dimension: "container", factor: 1 }],
];

const LOOKUP = new Map<string, UnitDef>();
for (const [aliases, def] of DEFS) for (const a of aliases) LOOKUP.set(a, def);

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Known unit definition, or undefined for an unknown unit. */
export function unitDef(unit: string | null | undefined): UnitDef | undefined {
  if (unit === null || unit === undefined) return undefined;
  const u = normalizeText(unit).replace(/\.$/, "");
  return LOOKUP.get(u);
}

/**
 * Factor to convert a quantity in `from` (customer unit) into `to` (catalog unit), or null when
 * the units are incompatible / unknown. A missing customer unit means "the catalog unit"; a missing
 * catalog unit means "ud".
 */
export function unitFactor(from: string | null, to: string | null): number | null {
  if (from === null || from.trim() === "") return 1;
  const target = to === null || to.trim() === "" ? "ud" : to;
  if (normalizeText(from) === normalizeText(target)) return 1;
  const f = unitDef(from);
  const t = unitDef(target);
  if (!f || !t) return null;
  if (f.canonical === t.canonical) return 1;
  if (f.dimension !== t.dimension || f.dimension === "container") return null;
  return f.factor / t.factor;
}
