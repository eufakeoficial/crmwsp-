import { describe, expect, it } from "vitest";
import {
  extractVariables,
  hasOptOutLine,
  normalizeTemplateName,
  OPT_OUT_LINE,
  renderPreview,
  validateTemplateDraft,
  validateTemplateName,
  variableIssue,
} from "./wa-templates";

describe("validateTemplateName", () => {
  it("accepts lowercase letters, digits and underscores", () => {
    expect(validateTemplateName("promo_otono_2026")).toBeNull();
  });
  it("flags empty, uppercase, spaces, accents and too long names", () => {
    expect(validateTemplateName("")).toBe("empty");
    expect(validateTemplateName("Promo")).toBe("invalid_chars");
    expect(validateTemplateName("promo otono")).toBe("invalid_chars");
    expect(validateTemplateName("promoción")).toBe("invalid_chars");
    expect(validateTemplateName("a".repeat(513))).toBe("too_long");
  });
});

describe("normalizeTemplateName", () => {
  it("lowercases, strips accents and turns separators into underscores", () => {
    expect(normalizeTemplateName("  Promo Otoño-2026! ")).toBe("promo_otono_2026");
    expect(validateTemplateName(normalizeTemplateName("Hola Ñandú"))).toBeNull();
  });
});

describe("extractVariables", () => {
  it("returns unique sorted indexes", () => {
    expect(extractVariables("Hola {{2}}, tu pedido {{1}} y {{ 2 }}")).toEqual([1, 2]);
    expect(extractVariables("Sin variables")).toEqual([]);
  });
});

describe("variableIssue", () => {
  it("requires sequential indexes starting at 1", () => {
    expect(variableIssue("Hola {{1}} {{2}} gracias")).toBeNull();
    expect(variableIssue("Hola {{2}} gracias")).toBe("not_sequential");
    expect(variableIssue("Hola {{1}} {{3}} gracias")).toBe("not_sequential");
  });
  it("rejects a body that starts or ends with a variable", () => {
    expect(variableIssue("{{1}} te saluda")).toBe("edge_variable");
    expect(variableIssue("Tu codigo es {{1}}")).toBe("edge_variable");
    expect(variableIssue("Tu codigo es {{1}}.")).toBeNull();
  });
});

describe("renderPreview", () => {
  it("fills samples and keeps unfilled placeholders visible", () => {
    expect(renderPreview("Hola {{1}}, tu turno es {{2}}.", ["Ana"])).toBe("Hola Ana, tu turno es {{2}}.");
    expect(renderPreview("Hola {{1}}", ["  "])).toBe("Hola {{1}}");
  });
});

describe("hasOptOutLine", () => {
  it("detects the BAJA opt-out wording", () => {
    expect(hasOptOutLine(`Oferta. ${OPT_OUT_LINE}`)).toBe(true);
    expect(hasOptOutLine("Responde baja para salir")).toBe(true);
    expect(hasOptOutLine("Oferta del mes")).toBe(false);
  });
});

describe("validateTemplateDraft", () => {
  const ok = { name: "promo", language: "es", category: "utility" as const, body: "Hola {{1}}, gracias.", samples: ["Ana"] };
  it("returns a request that matches the contract when valid", () => {
    const r = validateTemplateDraft(ok);
    expect(r.errors).toEqual({});
    expect(r.request).toEqual({ name: "promo", language: "es", category: "utility", body: "Hola {{1}}, gracias.", example: "Hola Ana, gracias." });
  });
  it("omits example when the body has no variables", () => {
    expect(validateTemplateDraft({ ...ok, body: "Hola", samples: [] }).request).not.toHaveProperty("example");
  });
  it("reports per-field errors", () => {
    const r = validateTemplateDraft({ ...ok, name: "Bad Name", language: "xx_yy", body: "", samples: [] });
    expect(r.request).toBeNull();
    expect(Object.keys(r.errors).sort()).toEqual(["body", "language", "name"]);
  });
  it("requires a sample for each variable", () => {
    const r = validateTemplateDraft({ ...ok, samples: [""] });
    expect(r.errors.samples).toBeDefined();
    expect(r.request).toBeNull();
  });
  it("flags non-sequential variables", () => {
    expect(validateTemplateDraft({ ...ok, body: "Hola {{2}}, gracias.", samples: ["", "x"] }).errors.body).toBeDefined();
  });
});
