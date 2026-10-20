import { z } from "zod";

/** CSV contact import. The same parser runs in the browser (preview) and in the API (source of truth). */

export const IMPORT_MAX_ROWS = 5_000;
export const IMPORT_MAX_BYTES = 2_000_000;

export const importContactsRequestSchema = z.object({ csv: z.string().min(1).max(IMPORT_MAX_BYTES) });
export type ImportContactsRequest = z.infer<typeof importContactsRequestSchema>;

export const importSkipReasonSchema = z.enum(["missing_phone", "invalid_phone", "duplicate_in_file", "invalid_tags"]);
export type ImportSkipReason = z.infer<typeof importSkipReasonSchema>;

export const importContactsResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  skipped: z.array(z.object({ line: z.number().int(), reason: importSkipReasonSchema })),
});
export type ImportContactsResult = z.infer<typeof importContactsResultSchema>;

export interface CsvContactRow {
  /** 1-based line in the file (header = line 1). */
  line: number;
  phone: string;
  name: string;
  email: string;
  tags: string[];
  /** Only set when the file has an explicit marketing consent column with a recognizable value. */
  marketingConsent: "granted" | "revoked" | null;
}

export interface ParsedContactCsv {
  rows: CsvContactRow[];
  /** Columns recognized from the header. */
  columns: { phone: boolean; name: boolean; email: boolean; tags: boolean; marketingConsent: boolean };
  /** Data rows beyond IMPORT_MAX_ROWS. */
  truncated: boolean;
}

const HEADER_ALIASES: Record<keyof ParsedContactCsv["columns"], readonly string[]> = {
  phone: ["phone", "telefono", "tel", "movil", "celular", "whatsapp"],
  name: ["name", "nombre"],
  email: ["email", "correo", "mail", "e_mail"],
  tags: ["tags", "etiquetas", "etiqueta", "tag"],
  marketingConsent: ["marketing_consent", "consentimiento_marketing", "acepta_marketing", "marketing"],
};

const normHeader = (h: string): string =>
  h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const CONSENT_YES = new Set(["si", "sí", "yes", "true", "1", "granted", "aceptado", "x"]);
const CONSENT_NO = new Set(["no", "false", "0", "revoked", "revocado"]);

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF/LF, `,` or `;` delimiter (sniffed from header). */
export function parseCsvRecords(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      records.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    records.push(row);
  }
  return records;
}

export function parseContactCsv(text: string): ParsedContactCsv {
  const records = parseCsvRecords(text);
  const header = (records[0] ?? []).map(normHeader);
  const idx = Object.fromEntries(
    Object.entries(HEADER_ALIASES).map(([k, aliases]) => [k, header.findIndex((h) => aliases.includes(h))]),
  ) as Record<keyof ParsedContactCsv["columns"], number>;
  const cell = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows: CsvContactRow[] = [];
  let truncated = false;
  for (let n = 1; n < records.length; n++) {
    const r = records[n]!;
    if (r.every((v) => v.trim() === "")) continue;
    if (rows.length >= IMPORT_MAX_ROWS) {
      truncated = true;
      break;
    }
    const consentRaw = cell(r, idx.marketingConsent).toLowerCase();
    rows.push({
      line: n + 1,
      phone: cell(r, idx.phone),
      name: cell(r, idx.name),
      email: cell(r, idx.email),
      tags: cell(r, idx.tags)
        .split(/[|,;]/)
        .map((t) => t.trim())
        .filter(Boolean),
      marketingConsent: CONSENT_YES.has(consentRaw) ? "granted" : CONSENT_NO.has(consentRaw) ? "revoked" : null,
    });
  }
  return {
    rows,
    truncated,
    columns: {
      phone: idx.phone >= 0,
      name: idx.name >= 0,
      email: idx.email >= 0,
      tags: idx.tags >= 0,
      marketingConsent: idx.marketingConsent >= 0,
    },
  };
}
