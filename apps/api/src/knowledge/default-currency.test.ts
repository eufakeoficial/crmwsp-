import { parseCsvCatalog } from "@crmwsp/knowledge";
import { describe, expect, it } from "vitest";
import { withDefaultCurrency } from "./default-currency.js";

describe("withDefaultCurrency", () => {
  it("adds a currency column when the file has none, keeping line numbers", () => {
    const text = "nombre;precio\nCable;1250\n\nTubo;abc\n";
    const out = withDefaultCurrency(text, "CLP");
    expect(out.split("\n")).toEqual(["nombre;precio;currency", "Cable;1250;CLP", "", "Tubo;abc;CLP", ""]);
    const r = parseCsvCatalog(out);
    expect(r.rows).toMatchObject([{ name: "Cable", currency: "CLP", price_minor: 1250 }]);
    expect(r.errors.map((e) => e.line)).toEqual([4]);
  });
  it("leaves files with a currency column untouched", () => {
    const text = "nombre;precio;moneda\nCable;12,50;EUR\n";
    expect(withDefaultCurrency(text, "CLP")).toBe(text);
  });
  it("handles BOM, CRLF, commas and quoted multi-line cells", () => {
    const text = '﻿name,price,description\r\n"A, b",5,"two\nlines"\r\n';
    const out = withDefaultCurrency(text, "USD");
    const r = parseCsvCatalog(out);
    expect(r.errors).toEqual([]);
    expect(r.rows).toMatchObject([{ name: "A, b", currency: "USD", price_minor: 500 }]);
  });
  it("a symbol that contradicts the default still fails", () => {
    const r = parseCsvCatalog(withDefaultCurrency("nombre;precio\nValvula;Bs 400\n", "EUR"));
    expect(r.rows).toEqual([]);
    expect(r.errors[0]?.reason).toMatch(/currency mismatch/);
  });
});
