export class KnowledgeError extends Error {
  constructor(
    readonly code: "pdf_too_large" | "pdf_too_many_pages" | "pdf_invalid" | "csv_missing_columns" | "csv_too_large" | "csv_too_many_rows",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
}

export const CATALOG_FIELDS = [
  "name",
  "sku",
  "price",
  "currency",
  "unit",
  "description",
  "stock",
  "lead_time",
] as const;
export type CatalogField = (typeof CATALOG_FIELDS)[number];

/** Maps a catalog field to the exact header text used in the CSV. */
export type ColumnMapping = Partial<Record<CatalogField, string>>;

export interface CatalogRow {
  /** 1-based physical line in the source where the record starts. */
  line: number;
  name: string;
  sku?: string;
  price_minor: number;
  currency: string;
  unit?: string;
  description?: string;
  stock?: number;
  lead_time?: string;
}

export interface RowError {
  /** 1-based line (0 = whole file / header). */
  line: number;
  reason: string;
  raw?: string;
}

export interface CatalogParseResult {
  rows: CatalogRow[];
  errors: RowError[];
  detectedMapping: ColumnMapping;
}

export interface FaqPair {
  question: string;
  answer: string;
}

export interface PdfParseResult {
  text: string;
  pages: number;
}

export type ChunkMetadata =
  | {
      kind: "catalog_item";
      sku?: string;
      name: string;
      price_minor: number;
      currency: string;
      unit?: string;
      stock?: number;
      lead_time?: string;
    }
  | { kind: "faq"; question: string }
  | { kind: "pdf" | "text" };

export interface Chunk {
  ordinal: number;
  content: string;
  metadata: ChunkMetadata;
}

export type ChunkInput =
  | { kind: "catalog"; rows: CatalogRow[] }
  | { kind: "faq"; pairs: FaqPair[] }
  | { kind: "pdf" | "text"; text: string };

export type SourcedCatalogRow = CatalogRow & { source: string };

export interface ConflictEntry {
  source: string;
  line: number;
  name: string;
  sku?: string;
  price_minor: number;
  currency: string;
}

export interface PriceConflict {
  matchedBy: "sku" | "name";
  /** cross_source: different sources disagree; duplicate_in_source: one source lists the item twice with different prices. */
  reason: "cross_source" | "duplicate_in_source";
  key: string;
  entries: ConflictEntry[];
}
