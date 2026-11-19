import { describe, expect, it } from "vitest";
import { updateTenantRequestSchema } from "../tenant.js";

describe("updateTenantRequestSchema", () => {
  it("trims the name", () => {
    expect(updateTenantRequestSchema.parse({ name: "  Acme SL  " })).toEqual({ name: "Acme SL" });
  });
  it("enforces 2-80 chars after trimming", () => {
    expect(updateTenantRequestSchema.safeParse({ name: " a " }).success).toBe(false);
    expect(updateTenantRequestSchema.safeParse({ name: "ab" }).success).toBe(true);
    expect(updateTenantRequestSchema.safeParse({ name: "x".repeat(80) }).success).toBe(true);
    expect(updateTenantRequestSchema.safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });
  it("rejects the slug and unknown keys", () => {
    expect(updateTenantRequestSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(false);
  });
});
