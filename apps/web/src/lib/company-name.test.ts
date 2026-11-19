import { describe, expect, it } from "vitest";
import { companyNameChanged, companyNameIssue } from "./company-name";

describe("companyNameIssue", () => {
  it("accepts 2-80 chars after trimming", () => {
    expect(companyNameIssue("  Ab ")).toBeNull();
    expect(companyNameIssue("x".repeat(80))).toBeNull();
  });
  it("explains too short and too long", () => {
    expect(companyNameIssue(" a ")).toMatch(/al menos 2/);
    expect(companyNameIssue("x".repeat(81))).toMatch(/80/);
  });
});

describe("companyNameChanged", () => {
  it("compares the trimmed draft", () => {
    expect(companyNameChanged("  Acme ", "Acme")).toBe(false);
    expect(companyNameChanged("Acme 2", "Acme")).toBe(true);
  });
});
