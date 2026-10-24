import { describe, expect, it } from "vitest";
import { isDisposableEmail, normalizeSignupEmail } from "./index.js";

describe("normalizeSignupEmail", () => {
  it("lowercases and strips +tags", () => {
    expect(normalizeSignupEmail("  Ana+Promo@Empresa.COM ")).toBe("ana@empresa.com");
  });
  it("removes dots for gmail and googlemail (and maps googlemail to gmail)", () => {
    expect(normalizeSignupEmail("j.u.a.n+x@gmail.com")).toBe("juan@gmail.com");
    expect(normalizeSignupEmail("J.uan@googlemail.com")).toBe("juan@gmail.com");
  });
  it("keeps dots for other domains and returns null for malformed input", () => {
    expect(normalizeSignupEmail("ana.perez@outlook.com")).toBe("ana.perez@outlook.com");
    expect(normalizeSignupEmail("no-at-sign")).toBeNull();
    expect(normalizeSignupEmail("+tag@gmail.com")).toBeNull();
  });
});

describe("isDisposableEmail", () => {
  it("detects known throwaway domains, including subdomains", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@foo.mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@YOPMAIL.com")).toBe(true);
    expect(isDisposableEmail("x@gmail.com")).toBe(false);
    expect(isDisposableEmail("x@empresa.bo")).toBe(false);
  });
});
