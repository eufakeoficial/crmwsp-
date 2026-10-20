import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  chunkDocument,
  contentHash,
  detectConflicts,
  parseCsvCatalog,
  parseFaq,
  parsePdf,
  parsePrice,
  splitText,
  KnowledgeError,
  MAX_PDF_BYTES,
  MAX_CSV_ROWS,
  MAX_CELL_CHARS,
  formatMinor,
  toMinor,
  type SourcedCatalogRow,
} from "../index.js";

const fx = (n: string) => readFileSync(join(import.meta.dirname, "fixtures", n), "utf8");

function makePdf(pages: string[]): Uint8Array {
  const objs: string[] = [];
  const n = pages.length;
  objs.push("<< /Type /Catalog /Pages 2 0 R >>");
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${n} >>`);
  objs.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  pages.forEach((t, i) => {
    const stream = `BT /F1 12 Tf 50 700 Td (${t}) Tj ET`;
    objs.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
    );
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

describe("parsePrice", () => {
  it.each([
    ["1.234,56", "1.234,56", null],
    ["1,234.56", "1,234.56", null],
    ["Bs 400", "400", "BOB"],
    ["€ 12,50", "12,50", "EUR"],
    ["12 EUR", "12", "EUR"],
    ["0,5", "0,5", null],
  ])("%s", (raw, number, cur) => {
    expect(parsePrice(raw)).toEqual({ ok: true, number, currency: cur });
  });
  it("does not take ordinary 3-letter words as currency codes", () => {
    expect(parsePrice("12 por")).toMatchObject({ ok: false });
  });
  it("rejects ambiguous $ and garbage", () => {
    expect(parsePrice("$ 30")).toMatchObject({ ok: true, currency: null, ambiguousSymbol: true });
    expect(parsePrice("abc").ok).toBe(false);
    expect(parsePrice("").ok).toBe(false);
  });
});

describe("toMinor: ISO 4217 decimals, integers only", () => {
  it.each([
    ["1.234,56", "EUR", 123456],
    ["1,234.56", "EUR", 123456],
    ["0,5", "EUR", 50],
    ["400", "BOB", 40000],
    ["12,50", "BOB", 1250],
    ["12.500", "CLP", 12500],
    ["1.234.567", "CLP", 1234567],
    ["1500", "JPY", 1500],
    ["1,500", "JPY", 1500],
    ["1.250", "KWD", 1250],
    ["3,5", "KWD", 3500],
    ["0.1", "EUR", 10],
    ["0.29", "EUR", 29],
    ["1.10", "EUR", 110],
    ["12.500", "EUR", 1250],
  ] as const)("%s %s -> %i", (num, cur, minor) => {
    const conv = num === "1.250" ? "." : num === "12.500" && cur === "EUR" ? "." : null;
    expect(toMinor(num, cur, conv)).toEqual({ ok: true, minor });
  });
  it("rejects fractions a currency cannot hold and huge values", () => {
    expect(toMinor("12,5", "CLP").ok).toBe(false);
    expect(toMinor("1,2345", "KWD").ok).toBe(false);
    expect(toMinor("99999999999999999999", "EUR").ok).toBe(false);
  });
  it("flags single separator + 3 digits as ambiguous without a file convention", () => {
    expect(toMinor("1.234", "EUR")).toEqual({ ok: false, reason: "ambiguous_number_format" });
    expect(toMinor("12,500", "BOB")).toEqual({ ok: false, reason: "ambiguous_number_format" });
    expect(toMinor("1.234", "EUR", ",")).toEqual({ ok: true, minor: 123400 });
    expect(toMinor("12,500", "BOB", ",")).toEqual({ ok: true, minor: 1250 });
  });
  it("never uses float math (0.1+0.2 style values are exact)", () => {
    expect(toMinor("0.30", "EUR")).toEqual({ ok: true, minor: 30 });
    expect(toMinor("19.99", "USD")).toEqual({ ok: true, minor: 1999 });
    expect(toMinor("1.005", "KWD", ".")).toEqual({ ok: true, minor: 1005 });
  });
  it("formatMinor uses currency decimals", () => {
    expect(formatMinor(78000, "EUR")).toBe("780");
    expect(formatMinor(1250, "EUR")).toBe("12.50");
    expect(formatMinor(5, "EUR")).toBe("0.05");
    expect(formatMinor(12500, "CLP")).toBe("12500");
    expect(formatMinor(1500, "JPY")).toBe("1500");
    expect(formatMinor(1250, "KWD")).toBe("1.250");
    expect(formatMinor(4050, "BOB")).toBe("40.50");
  });
});

describe("parseCsvCatalog: decimal convention and limits", () => {
  it("infers decimal comma from other rows", () => {
    const r = parseCsvCatalog("nombre;precio;moneda\nA;12,50;EUR\nB;12,500;EUR\nC;1.234;EUR");
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => x.price_minor)).toEqual([1250, 1250, 123400]);
  });
  it("infers thousands dot from rows like 1.234,56", () => {
    const r = parseCsvCatalog("nombre;precio;moneda\nA;1.234,56;EUR\nB;1.234;EUR");
    expect(r.rows.map((x) => x.price_minor)).toEqual([123456, 123400]);
  });
  it("sends ambiguous rows to errors when the file gives no convention", () => {
    const r = parseCsvCatalog("name,price,currency\nA,1.234,EUR\nB,40,EUR");
    expect(r.rows.map((x) => x.name)).toEqual(["B"]);
    expect(r.errors).toEqual([expect.objectContaining({ line: 2, reason: "ambiguous_number_format" })]);
  });
  it("sends ambiguous rows to errors when the file contradicts itself", () => {
    const r = parseCsvCatalog("name;price;currency\nA;12,50;EUR\nB;1,234.50;EUR\nC;1.234;EUR");
    expect(r.errors.map((e) => e.reason)).toEqual(["ambiguous_number_format"]);
  });
  it("uses 0 decimals for CLP rows", () => {
    const r = parseCsvCatalog("nombre;precio;moneda\nA;12.500;CLP");
    expect(r.rows[0]?.price_minor).toBe(12500);
  });
  it("enforces size, row and cell limits", () => {
    expect(() => parseCsvCatalog("name,price\n" + "x,1 EUR\n".repeat(MAX_CSV_ROWS + 1))).toThrow(/limit/);
    expect(() => parseCsvCatalog("a".repeat(10 * 1024 * 1024 + 1))).toThrow(KnowledgeError);
    const r = parseCsvCatalog(`name,price\n${"x".repeat(MAX_CELL_CHARS + 1)},1 EUR`);
    expect(r.errors[0]?.reason).toMatch(/cell_too_long/);
  });
});

describe("ReDoS: 100 KB adversarial inputs stay fast", () => {
  const big = 100 * 1024;
  it.each([
    ["price spaces", () => parsePrice("1" + " ".repeat(big) + "x")],
    ["price separators", () => parsePrice("1" + ".,".repeat(big / 2) + "x")],
    ["price letters", () => parsePrice("a".repeat(big))],
    ["faq heading", () => parseFaq("## a" + " ".repeat(big) + "x\nbody")],
    ["faq heading hashes", () => parseFaq("## " + "# ".repeat(big / 2) + "x\nbody")],
    ["faq qa", () => parseFaq("P" + " ".repeat(big) + "x")],
    ["split blank lines", () => splitText("a\n" + " ".repeat(big) + "b")],
    ["csv quotes", () => parseCsvCatalog('"' + '""'.repeat(big / 2))],
  ])("%s", (_n, fn) => {
    const t = performance.now();
    fn();
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("parseCsvCatalog", () => {
  it("parses Spanish ; CSV with BOM and decimal comma", () => {
    const r = parseCsvCatalog(fx("catalog-es.csv"));
    expect(r.errors).toEqual([]);
    expect(r.detectedMapping).toMatchObject({ name: "Producto", sku: "SKU", price: "Precio", lead_time: "Plazo" });
    expect(r.rows[0]).toMatchObject({ name: "Instalación split 3000 frigorías", sku: "INS-3000", price_minor: 123456, currency: "EUR", stock: 5, lead_time: "3 días" });
    expect(r.rows[1]).toMatchObject({ price_minor: 8050, unit: "visita" });
  });
  it("parses English CSV", () => {
    const r = parseCsvCatalog(fx("catalog-en.csv"));
    expect(r.rows[0]).toMatchObject({ name: "Split install", price_minor: 123456, currency: "USD", lead_time: "2 weeks", stock: 3 });
    expect(r.rows[1]).toMatchObject({ price_minor: 4000, currency: "USD" });
  });
  it("sends ambiguous currency rows to errors and never guesses", () => {
    const r = parseCsvCatalog(fx("catalog-ambiguous.csv"));
    expect(r.rows.map((x) => [x.name, x.currency])).toEqual([["Tubo", "BOB"], ["Filtro", "EUR"]]);
    expect(r.errors.map((e) => e.line)).toEqual([2, 5, 6]);
    expect(r.errors.every((e) => /currency/.test(e.reason))).toBe(true);
  });
  it("handles quotes and newlines inside quotes", () => {
    const r = parseCsvCatalog(fx("catalog-quotes.csv"));
    expect(r.rows[0]).toMatchObject({ name: 'Pack "Pro"', description: "line one\nline two, with comma", line: 2 });
    expect(r.rows[1]?.line).toBe(4);
  });
  it("honors explicit mapping and reports missing columns", () => {
    const r = parseCsvCatalog("a,b\nX,5 EUR", { mapping: { name: "a", price: "b" } });
    expect(r.rows).toHaveLength(1);
    expect(parseCsvCatalog("foo,bar\n1,2").errors[0]?.reason).toMatch(/missing required/);
  });
});

describe("parsePdf", () => {
  it("extracts text and page count", async () => {
    const r = await parsePdf(makePdf(["Hello catalog", "Second page"]));
    expect(r.pages).toBe(2);
    expect(r.text).toContain("Hello catalog");
    expect(r.text).toContain("Second page");
  });
  it("enforces size and page limits", async () => {
    await expect(parsePdf(new Uint8Array(MAX_PDF_BYTES + 1))).rejects.toMatchObject({ code: "pdf_too_large" });
    await expect(parsePdf(makePdf(Array.from({ length: 301 }, (_, i) => `p${i}`)))).rejects.toMatchObject({ code: "pdf_too_many_pages" });
    await expect(parsePdf(new TextEncoder().encode("not a pdf"))).rejects.toBeInstanceOf(KnowledgeError);
  });
});

describe("pdf.js build safety", () => {
  it("bundled pdf.js contains no eval / new Function code path", () => {
    const entry = join(dirname(createRequire(import.meta.url).resolve("unpdf")), "pdfjs.mjs");
    const src = readFileSync(entry, "utf8");
    expect(src).not.toMatch(/new Function\(|[^\w.]eval\(/);
  });
});

describe("parseFaq", () => {
  it("parses P:/R: with multiline answers", () => {
    expect(parseFaq(fx("faq-pr.txt"))).toEqual([
      { question: "¿Hacen facturas?", answer: "Sí, siempre.\nCon IVA." },
      { question: "¿Horario?", answer: "L-V 9 a 18." },
    ]);
  });
  it("parses Q:/A:", () => {
    expect(parseFaq(fx("faq-qa.txt"))).toHaveLength(2);
  });
  it("parses markdown ##", () => {
    expect(parseFaq(fx("faq.md"))).toEqual([
      { question: "¿Cuánto tarda?", answer: "Tres días." },
      { question: "¿Garantía?", answer: "Dos años." },
    ]);
  });
});

describe("chunkDocument", () => {
  it("catalog: one readable chunk per row with metadata", () => {
    const rows = parseCsvCatalog("nombre,sku,precio,moneda,unidad\nInstalación split 3000 frigorías,INS-3000,780,EUR,unidad").rows;
    const [c] = chunkDocument({ kind: "catalog", rows });
    expect(c?.content).toBe("Instalación split 3000 frigorías — 780 EUR por unidad. SKU INS-3000.");
    expect(chunkDocument({ kind: "catalog", rows: parseCsvCatalog("nombre;precio;moneda\nX;12.500;CLP").rows })[0]).toMatchObject({
      content: "X — 12500 CLP.",
      metadata: { price_minor: 12500, currency: "CLP" },
    });
    expect(c?.metadata).toEqual({ kind: "catalog_item", sku: "INS-3000", name: "Instalación split 3000 frigorías", price_minor: 78000, currency: "EUR", unit: "unidad" });
  });
  it("faq: one chunk per pair", () => {
    expect(chunkDocument({ kind: "faq", pairs: parseFaq(fx("faq.md")) })).toHaveLength(2);
  });
  it("text: respects paragraphs and overlaps", () => {
    const paras = Array.from({ length: 12 }, (_, i) => `Para${i} ` + "word ".repeat(150).trim());
    const chunks = splitText(paras.join("\n\n"), 1800, 300);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1800);
    for (let i = 1; i < chunks.length; i++) {
      const tail = (chunks[i - 1] as string).slice(-100);
      expect((chunks[i] as string).slice(0, 400)).toContain(tail.slice(-40));
    }
    const out = chunkDocument({ kind: "text", text: paras.join("\n\n") });
    expect(out.map((c) => c.ordinal)).toEqual(out.map((_, i) => i));
  });
  it("splits a single giant paragraph", () => {
    const chunks = splitText("palabra ".repeat(2000));
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.length <= 3200)).toBe(true);
  });
  it("contentHash is stable and change-sensitive", () => {
    const a = contentHash({ kind: "text", text: "x\r\ny" });
    expect(a).toBe(contentHash({ kind: "text", text: "x\ny" }));
    expect(a).not.toBe(contentHash({ kind: "text", text: "x\nz" }));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(contentHash({ kind: "faq", pairs: [{ question: "q", answer: "a\r\nb" }] })).toBe(
      contentHash({ kind: "faq", pairs: [{ question: "q", answer: "a\nb" }] }),
    );
    const row = { line: 2, name: "X", price_minor: 1, currency: "EUR", description: "a\r\nb" };
    expect(contentHash({ kind: "catalog", rows: [row] })).toBe(contentHash({ kind: "catalog", rows: [{ ...row, line: 9, description: "a\nb" }] }));
  });
  it("never emits empty chunks", () => {
    const chunks = splitText("a\n\n" + " ".repeat(5000) + "\n\n\n\nb" + " ".repeat(4000), 1000, 100);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => c.trim().length > 0)).toBe(true);
    expect(splitText("  \r\n\r\n  ")).toEqual([]);
  });
});

describe("detectConflicts", () => {
  const r = (source: string, name: string, price_minor: number, sku?: string): SourcedCatalogRow => ({
    source, line: 2, name, price_minor, currency: "EUR", ...(sku && { sku }),
  });
  it("finds SKU and normalized-name conflicts across sources", () => {
    const out = detectConflicts([
      r("a.csv", "Split 3000", 78000, "INS-3000"),
      r("b.pdf", "Split 3000 frigorías", 85000, "ins-3000"),
      r("a.csv", "Instalación Básica", 10000),
      r("b.pdf", "instalacion  basica!", 12000),
      r("a.csv", "Same", 500, "S1"),
      r("b.pdf", "Same", 500, "S1"),
    ]);
    expect(out.map((c) => [c.matchedBy, c.reason, c.key])).toEqual([["sku", "cross_source", "INS-3000"], ["name", "cross_source", "instalacion basica"]]);
  });
  it("flags same-source duplicates with different prices", () => {
    const out = detectConflicts([r("a", "X", 1), r("a", "X", 2), r("a", "Y", 3), r("a", "Y", 3)]);
    expect(out).toEqual([expect.objectContaining({ matchedBy: "name", reason: "duplicate_in_source", key: "x" })]);
  });
});
