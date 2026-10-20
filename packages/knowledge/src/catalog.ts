import { parseCsv } from "./csv.js";
import { decimalEvidence, normalizeCurrency, parsePrice, toMinor } from "./price.js";
import {
  KnowledgeError,
  CATALOG_FIELDS,
  type CatalogField,
  type CatalogParseResult,
  type CatalogRow,
  type ColumnMapping,
  type RowError,
} from "./types.js";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 50_000;
export const MAX_CELL_CHARS = 10_000;

const SYNONYMS: Record<CatalogField, string[]> = {
  name: ["nombre", "producto", "servicio", "articulo", "item", "name", "product", "service", "title", "titulo"],
  sku: ["sku", "codigo", "cod", "code", "referencia", "ref", "item code", "product code"],
  price: ["precio", "price", "importe", "tarifa", "coste", "costo", "cost", "amount", "pvp", "unit price", "precio unitario"],
  currency: ["moneda", "currency", "divisa"],
  unit: ["unidad", "unit", "uom", "medida", "unidad de medida"],
  description: ["descripcion", "description", "detalle", "details", "notas", "notes"],
  stock: ["stock", "existencias", "inventario", "inventory", "cantidad", "qty", "quantity", "disponible"],
  lead_time: ["plazo", "plazo de entrega", "lead time", "leadtime", "lead_time", "entrega", "delivery", "delivery time", "tiempo de entrega"],
};

function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function detectMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const normalized = headers.map(normHeader);
  for (const field of CATALOG_FIELDS) {
    const syns = SYNONYMS[field];
    // Exact synonym match first, then "header contains synonym" as a fallback.
    let idx = normalized.findIndex((h, i) => syns.includes(h) && !isUsed(mapping, headers[i]));
    if (idx < 0) {
      idx = normalized.findIndex(
        (h, i) => h !== "" && !isUsed(mapping, headers[i]) && syns.some((s) => s.length > 3 && h.includes(s)),
      );
    }
    if (idx >= 0) mapping[field] = headers[idx] as string;
  }
  return mapping;
}

function isUsed(mapping: ColumnMapping, header: string | undefined): boolean {
  return header !== undefined && Object.values(mapping).includes(header);
}

export function parseCsvCatalog(text: string, opts: { mapping?: ColumnMapping } = {}): CatalogParseResult {
  if (Buffer.byteLength(text, "utf8") > MAX_CSV_BYTES) {
    throw new KnowledgeError("csv_too_large", `CSV exceeds the ${MAX_CSV_BYTES / 1024 / 1024} MB limit`);
  }
  const records = parseCsv(text);
  if (records.length - 1 > MAX_CSV_ROWS) {
    throw new KnowledgeError("csv_too_many_rows", `CSV has ${records.length - 1} rows; the limit is ${MAX_CSV_ROWS}`);
  }
  const errors: RowError[] = [];
  const headerRec = records[0];
  if (!headerRec) {
    return { rows: [], errors: [{ line: 0, reason: "empty file" }], detectedMapping: {} };
  }
  const headers = headerRec.cells.map((h) => h.trim());
  const detectedMapping = { ...detectMapping(headers), ...(opts.mapping ?? {}) };

  const col = (field: CatalogField): number => {
    const h = detectedMapping[field];
    return h === undefined ? -1 : headers.indexOf(h);
  };
  const idx = Object.fromEntries(CATALOG_FIELDS.map((f) => [f, col(f)])) as Record<CatalogField, number>;
  if (idx.name < 0 || idx.price < 0) {
    const missing = [idx.name < 0 ? "name" : null, idx.price < 0 ? "price" : null].filter(Boolean).join(", ");
    errors.push({ line: 0, reason: `missing required column(s): ${missing}` });
    return { rows: [], errors, detectedMapping };
  }

  // Rows are built in two passes: the decimal-separator convention is inferred from the whole file
  // before ambiguous numbers like "1.234" or "12,500" are converted.
  const pending: Array<{ row: Omit<CatalogRow, "price_minor">; number: string; raw: string }> = [];
  const cellOf = (cells: string[], f: CatalogField): string => (idx[f] >= 0 ? (cells[idx[f]] ?? "").trim() : "");

  for (const rec of records.slice(1)) {
    const raw = rec.cells.join(";").slice(0, 500);
    if (rec.cells.some((c) => c.length > MAX_CELL_CHARS)) {
      errors.push({ line: rec.line, reason: `cell_too_long: a cell exceeds ${MAX_CELL_CHARS} characters`, raw });
      continue;
    }
    const name = cellOf(rec.cells, "name");
    if (!name) {
      errors.push({ line: rec.line, reason: "missing name", raw });
      continue;
    }
    const price = parsePrice(cellOf(rec.cells, "price"));
    if (!price.ok) {
      errors.push({ line: rec.line, reason: price.reason, raw });
      continue;
    }
    let currency = price.currency;
    const curCell = cellOf(rec.cells, "currency");
    if (curCell) {
      const fromCol = normalizeCurrency(curCell);
      if (!fromCol) {
        errors.push({ line: rec.line, reason: `ambiguous or unknown currency "${curCell}"`, raw });
        continue;
      }
      if (currency && currency !== fromCol) {
        errors.push({ line: rec.line, reason: `currency mismatch: price says ${currency}, column says ${fromCol}`, raw });
        continue;
      }
      currency = fromCol;
    }
    if (!currency) {
      errors.push({ line: rec.line, reason: price.ambiguousSymbol ? "ambiguous currency symbol ($) and no currency column value" : "ambiguous currency: no currency column or unambiguous symbol", raw });
      continue;
    }
    const row: Omit<CatalogRow, "price_minor"> = { line: rec.line, name, currency };
    const sku = cellOf(rec.cells, "sku");
    if (sku) row.sku = sku;
    const unit = cellOf(rec.cells, "unit");
    if (unit) row.unit = unit;
    const desc = cellOf(rec.cells, "description");
    if (desc) row.description = desc;
    const lead = cellOf(rec.cells, "lead_time");
    if (lead) row.lead_time = lead;
    const stockRaw = cellOf(rec.cells, "stock");
    if (stockRaw) {
      if (!/^\d+$/.test(stockRaw)) {
        errors.push({ line: rec.line, reason: `invalid stock "${stockRaw}"`, raw });
        continue;
      }
      row.stock = Number(stockRaw);
    }
    pending.push({ row, number: price.number, raw });
  }

  const evidence = new Set(pending.map((p) => decimalEvidence(p.number)).filter((e) => e !== null));
  const convention = evidence.size === 1 ? [...evidence][0] ?? null : null;
  const rows: CatalogRow[] = [];
  for (const p of pending) {
    const m = toMinor(p.number, p.row.currency, convention);
    if (!m.ok) {
      errors.push({ line: p.row.line, reason: m.reason, raw: p.raw });
      continue;
    }
    const { line, name, ...rest } = p.row;
    rows.push({ line, name, price_minor: m.minor, ...rest });
  }
  errors.sort((a, b) => a.line - b.line);
  return { rows, errors, detectedMapping };
}
