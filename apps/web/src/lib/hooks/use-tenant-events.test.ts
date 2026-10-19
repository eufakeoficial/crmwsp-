import { describe, expect, it } from "vitest";
import { backoffDelay } from "./use-tenant-events";

describe("backoffDelay", () => {
  it("doubles and caps at 30 s", () => {
    expect([0, 1, 2, 3].map(backoffDelay)).toEqual([1000, 2000, 4000, 8000]);
    expect(backoffDelay(10)).toBe(30_000);
  });
});
