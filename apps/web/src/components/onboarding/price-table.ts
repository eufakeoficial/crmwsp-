/** Client-side parsing of a price list (CSV) into editable rows, and back to a CSV for the import endpoint. */

export interface PriceRow {
  name: string;
  variant: string;
  price: string;
  currency: string;
}

export const DEFAULT_CURRENCY = "EUR";
export const MAX_PREVIEW_ROWS = 2000;

const SYMBOLS: Record<string, string> = { "€": "EUR", $: "USD", "£": "GBP" };
const HEADERS = {
  name: ["nombre", "producto", "servicio", "articulo", "item", "name", "product", "service", "titulo", "title", "descripcion"],
  variant: ["variante", "variant", "talla", "size", "color", "modelo", "presentacion"],
  price: ["precio", "price", "importe", "tarifa", "coste", "costo", "pvp", "amount", "precio unitario"],
  currency: ["moneda", "currency", "divisa"],
} as const;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function detectDelimiter(line: string): string {
  const counts = [",", ";", "\t"].map((d) => [d, line.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![0];
}

/** RFC 4180-ish parser with quotes and an auto-detected delimiter. */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const delim = detectDelimiter(src.split(/\r?\n/, 1)[0] ?? "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

function currencyFromPrice(price: string): string | undefined {
  for (const [sym, code] of Object.entries(SYMBOLS)) if (price.includes(sym)) return code;
  return undefined;
}

/** Maps a parsed CSV to preview rows. Returns an error message when name/price columns can't be found. */
export function rowsFromCsv(records: string[][]): { rows: PriceRow[]; error?: string; truncated?: boolean } {
  const header = records[0];
  if (!header) return { rows: [], error: "El archivo está vacío." };
  const heads = header.map(norm);
  const used = new Set<number>();
  const pick = (names: readonly string[]) => {
    let idx = heads.findIndex((h, i) => !used.has(i) && names.includes(h));
    if (idx < 0) idx = heads.findIndex((h, i) => !used.has(i) && h !== "" && names.some((n) => n.length > 3 && h.includes(n)));
    if (idx >= 0) used.add(idx);
    return idx;
  };
  const price = pick(HEADERS.price);
  const name = pick(HEADERS.name);
  const variant = pick(HEADERS.variant);
  const currency = pick(HEADERS.currency);
  if (name < 0 || price < 0) {
    return { rows: [], error: "No encontramos las columnas de nombre y precio. Usa cabeceras como «nombre» y «precio»." };
  }
  const body = records.slice(1);
  const rows = body.slice(0, MAX_PREVIEW_ROWS).map((r) => {
    const rawPrice = (r[price] ?? "").trim();
    const cur = currency >= 0 ? (r[currency] ?? "").trim().toUpperCase() : "";
    return {
      name: (r[name] ?? "").trim(),
      variant: variant >= 0 ? (r[variant] ?? "").trim() : "",
      price: rawPrice.replace(/[€$£]/g, "").trim(),
      currency: (cur || currencyFromPrice(rawPrice) || DEFAULT_CURRENCY).slice(0, 3),
    };
  });
  return { rows, truncated: body.length > MAX_PREVIEW_ROWS };
}

/** "12,50", "1.234,50", "1,234.50", "12" -> canonical decimal string, or null when not a price. */
export function normalizePrice(raw: string): string | null {
  const s = raw.trim().replace(/\s/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let out = s;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    out = s.split(dec === "." ? "," : ".").join("").replace(dec, ".");
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // Several separators, or one followed by exactly 3 digits after a short leading group, are thousands separators.
    const thousands = parts.length > 2 || (parts[1]!.length === 3 && parts[0]!.length <= 3 && parts[0] !== "0");
    out = thousands ? parts.join("") : `${parts[0]}.${parts[1]}`;
  }
  const n = Number(out);
  return Number.isFinite(n) && n >= 0 ? String(n) : null;
}

export interface RowIssue {
  index: number;
  reason: string;
}

export function validateRows(rows: PriceRow[]): RowIssue[] {
  const issues: RowIssue[] = [];
  rows.forEach((r, index) => {
    if (!r.name.trim()) issues.push({ index, reason: "Falta el nombre" });
    else if (normalizePrice(r.price) === null) issues.push({ index, reason: "Precio no válido" });
    else if (!/^[A-Za-z]{3}$/.test(r.currency.trim())) issues.push({ index, reason: "Moneda no válida (3 letras)" });
  });
  return issues;
}

const q = (s: string) => (/[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Canonical CSV for the existing knowledge import endpoint. The variant is folded into the name
 * ("Camiseta - M") because the catalog CSV importer has no variant column.
 */
export function rowsToCsv(rows: PriceRow[]): string {
  const lines = rows.map((r) =>
    [q(r.variant.trim() ? `${r.name.trim()} - ${r.variant.trim()}` : r.name.trim()), normalizePrice(r.price) ?? "", r.currency.trim().toUpperCase()].join(","),
  );
  return ["nombre,precio,moneda", ...lines].join("\n");
}
