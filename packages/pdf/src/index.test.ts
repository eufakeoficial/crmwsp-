import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QuoteDocumentSchema,
  computeQuoteTotals,
  divRoundHalfEven,
  encodeQr,
  formatMoney,
  renderQuotePdf,
  type QuoteDocumentInput,
} from "./index";
import { formatBits } from "./qr";
import { countPages, extractText } from "./test-utils";

const item = (over: Partial<QuoteDocumentInput["items"][number]> = {}) => ({
  description: "Service",
  quantity: 1,
  unitPriceMinor: 1000,
  ...over,
});

function makeQuote(count: number, over: Partial<QuoteDocumentInput> = {}): QuoteDocumentInput {
  return {
    number: "P-2026-0042",
    issueDate: "2026-10-20",
    validUntil: "2026-11-19",
    currency: "EUR",
    seller: { name: "Frío Vilafranca SL", taxId: "B12345678", address: "C/ Major 12, Vilafranca", email: "hola@frio.example" },
    customer: { name: "Marta Puig", phone: "+34 600 000 000" },
    items: Array.from({ length: count }, (_, i) => ({
      description: `Instalación equipo de aire ${i + 1} con mano de obra y materiales`,
      quantity: 1 + (i % 3),
      unit: "ud",
      unitPriceMinor: 12_345 + i * 100,
      discountPercent: i % 4 === 0 ? 10 : undefined,
      taxRatePercent: i % 5 === 0 ? 10 : 21,
    })),
    ...over,
  };
}

describe("divRoundHalfEven", () => {
  it("rounds ties to the even neighbour", () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n); // 2.5 -> 2
    expect(divRoundHalfEven(7n, 2n)).toBe(4n); // 3.5 -> 4
    expect(divRoundHalfEven(1n, 2n)).toBe(0n);
    expect(divRoundHalfEven(3n, 2n)).toBe(2n);
    expect(divRoundHalfEven(26n, 10n)).toBe(3n);
    expect(divRoundHalfEven(24n, 10n)).toBe(2n);
  });
});

describe("computeQuoteTotals", () => {
  it("handles a simple line without discount or tax", () => {
    const t = computeQuoteTotals([item({ quantity: 3, unitPriceMinor: 1999 })]);
    expect(t).toMatchObject({ subtotalMinor: 5997, discountTotalMinor: 0, taxTotalMinor: 0, totalMinor: 5997, taxes: [] });
  });

  it("rounds half-even on tax (banker's rounding)", () => {
    // 50 * 5% = 2.5 -> 2 ; 70 * 5% = 3.5 -> 4
    expect(computeQuoteTotals([item({ unitPriceMinor: 50, taxRatePercent: 5 })]).taxTotalMinor).toBe(2);
    expect(computeQuoteTotals([item({ unitPriceMinor: 70, taxRatePercent: 5 })]).taxTotalMinor).toBe(4);
  });

  it("rounds fractional quantities half-even", () => {
    // 0.5 * 5 = 2.5 -> 2 ; 0.5 * 7 = 3.5 -> 4
    expect(computeQuoteTotals([item({ quantity: 0.5, unitPriceMinor: 5 })]).subtotalMinor).toBe(2);
    expect(computeQuoteTotals([item({ quantity: 0.5, unitPriceMinor: 7 })]).subtotalMinor).toBe(4);
    expect(computeQuoteTotals([item({ quantity: 1.333, unitPriceMinor: 1000 })]).subtotalMinor).toBe(1333);
  });

  it("applies discounts in basis points before tax", () => {
    const t = computeQuoteTotals([item({ unitPriceMinor: 10_000, discountPercent: 12.5, taxRatePercent: 21 })]);
    expect(t.discountTotalMinor).toBe(1250);
    expect(t.netTotalMinor).toBe(8750);
    expect(t.taxTotalMinor).toBe(1838); // 1837.5 -> 1838 (even)
    expect(t.totalMinor).toBe(10_588);
  });

  it("groups mixed tax rates and keeps totals consistent", () => {
    const t = computeQuoteTotals([
      item({ unitPriceMinor: 10_000, taxRatePercent: 21 }),
      item({ unitPriceMinor: 5_000, taxRatePercent: 10 }),
      item({ unitPriceMinor: 2_000, taxRatePercent: 21, discountPercent: 50 }),
      item({ unitPriceMinor: 700 }),
    ]);
    expect(t.taxes).toEqual([
      { ratePercent: 10, baseMinor: 5000, taxMinor: 500 },
      { ratePercent: 21, baseMinor: 11_000, taxMinor: 2310 },
    ]);
    expect(t.subtotalMinor).toBe(17_700);
    expect(t.discountTotalMinor).toBe(1000);
    expect(t.taxTotalMinor).toBe(2810);
    expect(t.totalMinor).toBe(17_700 - 1000 + 2810);
    expect(t.lines.reduce((n, l) => n + l.totalMinor, 0)).toBe(t.totalMinor);
  });

  it("works for 0-decimal currencies (amounts are plain integers)", () => {
    const t = computeQuoteTotals([item({ unitPriceMinor: 15_000, quantity: 2, taxRatePercent: 19 })]);
    expect(t.totalMinor).toBe(35_700);
    expect(formatMoney(t.totalMinor, "CLP", "es-CL")).toMatch(/35\.700/);
    expect(formatMoney(1234, "JPY", "ja-JP")).toMatch(/1,234/);
  });

  it("works for 2-decimal currencies", () => {
    expect(formatMoney(123_456, "EUR", "es")).toBe("1234,56 €".replace(" ", "\u00a0"));
    expect(formatMoney(5, "USD", "en-US")).toBe("$0.05");
    expect(formatMoney(-1999, "USD", "en-US")).toBe("-$19.99");
  });

  it("stays exact for the largest allowed amounts", () => {
    const big = item({ unitPriceMinor: 1_000_000_000, quantity: 999.999, taxRatePercent: 21 });
    const t = computeQuoteTotals([big]);
    expect(t.subtotalMinor).toBe(999_999_000_000);
    expect(t.taxTotalMinor).toBe(209_999_790_000);
    expect(Number.isSafeInteger(computeQuoteTotals(Array(500).fill(big)).totalMinor)).toBe(true);
  });
});

describe("schema", () => {
  const valid = makeQuote(1);
  it("accepts a valid quote and applies defaults", () => {
    const parsed = QuoteDocumentSchema.parse(valid);
    expect(parsed.locale).toBe("es");
    expect(parsed.brandColor).toBe("#d2f34c");
  });
  it("rejects negative quantities", () => {
    expect(QuoteDocumentSchema.safeParse({ ...valid, items: [item({ quantity: -1 })] }).success).toBe(false);
    expect(QuoteDocumentSchema.safeParse({ ...valid, items: [item({ quantity: 0 })] }).success).toBe(false);
  });
  it("rejects non-integer prices", () => {
    expect(QuoteDocumentSchema.safeParse({ ...valid, items: [item({ unitPriceMinor: 19.99 })] }).success).toBe(false);
  });
  it("rejects bad currency, percent and empty items", () => {
    expect(QuoteDocumentSchema.safeParse({ ...valid, currency: "XXQ" }).success).toBe(false);
    expect(QuoteDocumentSchema.safeParse({ ...valid, items: [item({ discountPercent: 101 })] }).success).toBe(false);
    expect(QuoteDocumentSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
  });
});

describe("qr", () => {
  it("produces a valid-sized matrix with finder patterns and a valid format word", () => {
    const m = encodeQr("https://pay.example.com/checkout/abc123");
    expect(m.length).toBe(29); // version 3
    for (const [r, c] of [[0, 0], [0, 22], [22, 0]] as const) {
      expect(m[r]?.[c]).toBe(true);
      expect(m[r + 3]?.[c + 3]).toBe(true);
      expect(m[r + 1]?.[c + 1]).toBe(false);
    }
    // Format info bits are BCH words (distinct for all 8 masks).
    expect(new Set(Array.from({ length: 8 }, (_, i) => formatBits(i))).size).toBe(8);
    expect(formatBits(0)).toBe(0b101010000010010);
  });
  it("rejects payloads that are too long", () => {
    expect(() => encodeQr("x".repeat(500))).toThrow();
  });
});

describe("renderQuotePdf", () => {
  it("renders a 3-item quote with number and formatted total", async () => {
    const quote = makeQuote(3, { notes: "Incluye desplazamiento.", terms: "Pago 50% por adelantado.", paymentLink: "https://pay.example.com/q/P-2026-0042" });
    const pdf = await renderQuotePdf(quote);
    expect(Buffer.from(pdf.subarray(0, 4)).toString("latin1")).toBe("%PDF");
    expect(countPages(pdf)).toBe(1);
    const text = extractText(pdf);
    const totals = computeQuoteTotals(QuoteDocumentSchema.parse(quote).items);
    expect(text).toContain("P-2026-0042");
    expect(text).toContain(formatMoney(totals.totalMinor, "EUR", "es").replace(/\u00a0/g, " "));
    expect(text).toContain("Página 1 de 1");
    expect(text).toContain("Incluye desplazamiento.");
    if (process.env.PDF_SAMPLE_OUT) {
      mkdirSync(dirname(process.env.PDF_SAMPLE_OUT), { recursive: true });
      writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);
    }
  });

  it("paginates an 80-item quote, numbering every page", async () => {
    const quote = makeQuote(80);
    const pdf = await renderQuotePdf(quote);
    const pages = countPages(pdf);
    expect(pages).toBeGreaterThan(1);
    const text = extractText(pdf);
    expect(text).toContain(`Página ${pages} de ${pages}`);
    expect(text).toContain("Página 1 de " + pages);
    // table header repeats on each page that has rows
    expect(text.split("Descripción").length - 1).toBeGreaterThanOrEqual(2);
    const totals = computeQuoteTotals(QuoteDocumentSchema.parse(quote).items);
    expect(text).toContain(formatMoney(totals.totalMinor, "EUR", "es").replace(/\u00a0/g, " "));
    if (process.env.PDF_SAMPLE_OUT_LONG) writeFileSync(process.env.PDF_SAMPLE_OUT_LONG, pdf);
  });

  it("renders 0-decimal currency and English labels", async () => {
    const pdf = await renderQuotePdf(makeQuote(2, { currency: "CLP", locale: "es-CL" }));
    expect(extractText(pdf)).toMatch(/\$\s?\d{1,3}(\.\d{3})+/);
    const en = await renderQuotePdf(makeQuote(2, { locale: "en-US" }));
    expect(extractText(en)).toContain("Page 1 of 1");
  });

  it("rejects invalid input", async () => {
    await expect(renderQuotePdf(makeQuote(1, { items: [item({ quantity: -2 })] }))).rejects.toThrow();
  });
});
