import { describe, expect, it } from "vitest";
import { cn } from "./cn";
import { formatMoney, formatRelative } from "./format";

describe("cn", () => {
  it("resolves tailwind conflicts, last wins", () => {
    expect(cn("px-2 px-4", false, "text-ink")).toBe("px-4 text-ink");
  });
});

describe("format", () => {
  it("formats money with the currency code or symbol", () => {
    expect(formatMoney(1500, "USD")).toMatch(/1\D?500/);
  });
  it("formats relative time", () => {
    const now = new Date("2026-01-01T12:00:00Z");
    expect(formatRelative("2026-01-01T11:55:00Z", now)).toBe("hace 5 min");
    expect(formatRelative("2025-12-30T12:00:00Z", now)).toBe("hace 2 d");
  });
});
