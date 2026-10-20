import { describe, expect, it } from "vitest";
import { renderTemplateBody, validateTemplateParams } from "./index.js";

describe("validateTemplateParams", () => {
  const body = "Hola {{1}}, tu presupuesto {{2}} está listo.";
  it("accepts one non-blank param per placeholder", () => {
    expect(validateTemplateParams(body, ["Ana", "P-12"])).toBeNull();
    expect(validateTemplateParams("Sin variables", [])).toBeNull();
  });
  it("rejects a count mismatch", () => {
    expect(validateTemplateParams(body, ["Ana"])).toBe("count_mismatch");
    expect(validateTemplateParams(body, ["Ana", "P-12", "x"])).toBe("count_mismatch");
    expect(validateTemplateParams("Sin variables", ["x"])).toBe("count_mismatch");
  });
  it("rejects blank or oversized params", () => {
    expect(validateTemplateParams(body, ["Ana", "  "])).toBe("empty_param");
    expect(validateTemplateParams(body, ["Ana", "x".repeat(1025)])).toBe("param_too_long");
  });
});

describe("renderTemplateBody", () => {
  it("fills placeholders by position", () => {
    expect(renderTemplateBody("Hola {{1}}, ref {{ 2 }}", ["Ana", "P-12"])).toBe("Hola Ana, ref P-12");
  });
  it("leaves unknown placeholders untouched", () => {
    expect(renderTemplateBody("Hola {{1}} {{3}}", ["Ana"])).toBe("Hola Ana {{3}}");
  });
});
