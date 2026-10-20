import { describe, expect, it } from "vitest";
import { normalizePrice, parseCsvText, rowsFromCsv, rowsToCsv, validateRows } from "./price-table";

describe("price-table", () => {
  it("parses semicolon CSV with quotes and detects columns", () => {
    const parsed = rowsFromCsv(parseCsvText('Producto;Talla;Precio;Moneda\n"Camiseta; roja";M;12,50;USD\nGorra;;9 €;'));
    expect(parsed.rows).toEqual([
      { name: "Camiseta; roja", variant: "M", price: "12,50", currency: "USD" },
      { name: "Gorra", variant: "", price: "9", currency: "EUR" },
    ]);
  });
  it("reports missing columns", () => {
    expect(rowsFromCsv(parseCsvText("a,b\n1,2")).error).toMatch(/nombre y precio/);
  });
  it("normalizes prices", () => {
    expect(normalizePrice("1.234,50")).toBe("1234.5");
    expect(normalizePrice("1,234.50")).toBe("1234.5");
    expect(normalizePrice("12,50")).toBe("12.5");
    expect(normalizePrice("1.500")).toBe("1500");
    expect(normalizePrice("abc")).toBeNull();
  });
  it("validates and exports canonical CSV folding the variant", () => {
    const rows = [{ name: "Camiseta", variant: "M", price: "12,5", currency: "eur" }];
    expect(validateRows(rows)).toEqual([]);
    expect(rowsToCsv(rows)).toBe("nombre,precio,moneda\nCamiseta - M,12.5,EUR");
    expect(validateRows([{ name: "", variant: "", price: "x", currency: "EU" }])).toHaveLength(1);
  });
});
