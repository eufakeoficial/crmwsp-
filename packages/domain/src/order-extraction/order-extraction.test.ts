import { describe, expect, it } from "vitest";
import {
  buildOrderConfirmationReply,
  candidateScore,
  draftLines,
  looksLikeOrder,
  matchLine,
  matchOrderLines,
  unitFactor,
  type CatalogCandidate,
} from "./index.js";

const cand = (over: Partial<CatalogCandidate> & { label: string }): CatalogCandidate => ({
  productId: over.label,
  variantId: null,
  productVersion: 1,
  searchText: "",
  sku: null,
  unit: "caja",
  priceMinor: 1000n,
  currency: "EUR",
  taxRateBp: 2100,
  ...over,
});

const catalog: CatalogCandidate[] = [
  cand({ label: "Modelo A", sku: "MA-01", priceMinor: 2500n }),
  cand({ label: "Modelo B rojo", productId: "B", variantId: "B-r", searchText: "Modelo B rojo" }),
  cand({ label: "Modelo B azul", productId: "B", variantId: "B-a", searchText: "Modelo B azul" }),
  cand({ label: "Huevos de campo", unit: "ud", priceMinor: 30n }),
  cand({ label: "Harina de trigo", unit: "kg", priceMinor: 120n }),
  cand({ label: "Aceite de oliva", unit: "l", priceMinor: 900n, currency: "USD" }),
];

describe("unitFactor", () => {
  it("converts within a dimension", () => {
    expect(unitFactor("docena", "ud")).toBe(12);
    expect(unitFactor("gramos", "kg")).toBe(0.001);
    expect(unitFactor("Kilos", "kg")).toBe(1);
    expect(unitFactor("ml", "litro")).toBe(0.001);
  });
  it("treats synonyms, plurals and missing units", () => {
    expect(unitFactor("cajas", "caja")).toBe(1);
    expect(unitFactor(null, "caja")).toBe(1);
    expect(unitFactor("unidades", null)).toBe(1);
  });
  it("refuses incompatible or container conversions", () => {
    expect(unitFactor("cajas", "ud")).toBeNull();
    expect(unitFactor("kg", "l")).toBeNull();
    expect(unitFactor("bolsa", "caja")).toBeNull();
    expect(unitFactor("furgonetas", "ud")).toBeNull();
  });
});

describe("matchLine", () => {
  it("matches a clear name and converts the quantity to the catalog unit", () => {
    const m = matchLine({ rawText: "12 cajas del modelo A", quantity: 12, unit: "cajas", productGuess: "modelo A" }, catalog);
    expect(m.status).toBe("matched");
    expect(m.match?.productId).toBe("Modelo A");
    expect(m.match?.unitPriceMinor).toBe(2500n);
    expect(m.quantityMilli).toBe(12_000n);
  });
  it("matches by SKU with full confidence", () => {
    expect(candidateScore("ma-01", catalog[0]!)).toBe(1);
    expect(matchLine({ rawText: "", quantity: 1, unit: null, productGuess: "MA-01" }, catalog).confidence).toBe(1);
  });
  it("converts dozens and grams", () => {
    expect(matchLine({ rawText: "", quantity: 2, unit: "docenas", productGuess: "huevos" }, catalog).quantityMilli).toBe(24_000n);
    expect(matchLine({ rawText: "", quantity: 500, unit: "gramos", productGuess: "harina" }, catalog).quantityMilli).toBe(500n);
  });
  it("flags an ambiguous name with both candidates", () => {
    const m = matchLine({ rawText: "6 del B", quantity: 6, unit: null, productGuess: "modelo B" }, catalog);
    expect(m.status).toBe("dudoso");
    expect(m.reason).toBe("ambiguous");
    expect(m.match).toBeNull();
    expect(m.alternatives.slice(0, 2).map((a) => a.label)).toEqual(["Modelo B azul", "Modelo B rojo"]);
  });
  it("flags unknown products and never prices them", () => {
    const m = matchLine({ rawText: "", quantity: 3, unit: null, productGuess: "destornillador eléctrico" }, catalog);
    expect(m.status).toBe("dudoso");
    expect(["no_match", "low_confidence"]).toContain(m.reason);
    expect(m.match).toBeNull();
  });
  it("flags unit mismatch and missing quantity but keeps the match", () => {
    const u = matchLine({ rawText: "", quantity: 2, unit: "cajas", productGuess: "huevos de campo" }, catalog);
    expect(u.reason).toBe("unit_mismatch");
    expect(u.match?.label).toBe("Huevos de campo");
    expect(u.quantityMilli).toBeNull();
    expect(matchLine({ rawText: "", quantity: null, unit: null, productGuess: "modelo A" }, catalog).reason).toBe("no_quantity");
  });
});

describe("matchOrderLines + draftLines", () => {
  it("keeps one currency and drafts only matched lines with catalog prices", () => {
    const r = matchOrderLines(
      [
        { rawText: "", quantity: 12, unit: "cajas", productGuess: "modelo A" },
        { rawText: "", quantity: 6, unit: null, productGuess: "modelo B" },
        { rawText: "", quantity: 1, unit: "litro", productGuess: "aceite de oliva" },
      ],
      catalog,
    );
    expect(r.currency).toBe("EUR");
    expect(r.lines[2]!.reason).toBe("currency_mismatch");
    const d = draftLines(r.lines);
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]!.unitPriceMinor).toBe(2500n);
    expect(d.totals.subtotal).toBe(30_000n);
    expect(d.totals.tax).toBe(6_300n);
  });
});

describe("buildOrderConfirmationReply", () => {
  it("summarizes items and asks about the dudosos without prices", () => {
    const r = matchOrderLines(
      [
        { rawText: "", quantity: 12, unit: "cajas", productGuess: "modelo A" },
        { rawText: "", quantity: 6, unit: null, productGuess: "modelo B" },
      ],
      catalog,
    );
    const txt = buildOrderConfirmationReply(r.lines);
    expect(txt).toContain("12 caja — Modelo A");
    expect(txt).toContain("¿El «modelo B» es Modelo B azul o Modelo B rojo?");
    expect(txt).not.toMatch(/25|EUR|€/);
  });
});

describe("looksLikeOrder", () => {
  it("detects purchase requests in transcripts", () => {
    expect(looksLikeOrder("Hola, mándame 12 cajas del modelo A y 6 del B")).toBe(true);
    expect(looksLikeOrder("necesito dos docenas de huevos")).toBe(true);
    expect(looksLikeOrder("3 kilos de harina, 2 litros de aceite")).toBe(true);
  });
  it("ignores chit-chat", () => {
    expect(looksLikeOrder("hola, ¿a qué hora abren mañana?")).toBe(false);
    expect(looksLikeOrder("")).toBe(false);
  });
});
