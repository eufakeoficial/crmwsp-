import { describe, expect, it } from "vitest";
import { encodeForm } from "../form-encode.js";

describe("encodeForm", () => {
  it("encodes flat values and drops null/undefined", () => {
    expect(encodeForm({ a: "x", b: 1, c: true, d: false, e: undefined, f: null })).toBe("a=x&b=1&c=true&d=false");
  });
  it("uses bracket notation for nested objects and arrays", () => {
    expect(encodeForm({ line_items: [{ quantity: 1, price_data: { currency: "eur" } }], metadata: { k: "v" } })).toBe(
      "line_items[0][quantity]=1&line_items[0][price_data][currency]=eur&metadata[k]=v",
    );
  });
  it("percent-encodes values and key segments", () => {
    expect(encodeForm({ "a b": { "c&d": "é & = + ü'()*" } })).toBe("a%20b[c%26d]=%C3%A9%20%26%20%3D%20%2B%20%C3%BC%27%28%29%2A");
  });
  it("round-trips through URLSearchParams", () => {
    const p = new URLSearchParams(encodeForm({ m: { note: "50% off + más" } }));
    expect(p.get("m[note]")).toBe("50% off + más");
  });
  it("rejects empty keys, NaN and excessive depth", () => {
    expect(() => encodeForm({ "": "x" })).toThrow();
    expect(() => encodeForm({ a: Number.NaN })).toThrow();
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 12; i++) deep = { n: deep };
    expect(() => encodeForm(deep as never)).toThrow();
  });
});
