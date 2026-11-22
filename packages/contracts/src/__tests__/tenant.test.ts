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

describe("updateTenantRequestSchema timezone", () => {
  it("accepts name only, timezone only or both", () => {
    expect(updateTenantRequestSchema.safeParse({ name: "Acme" }).success).toBe(true);
    expect(updateTenantRequestSchema.safeParse({ timezone: "America/Lima" }).success).toBe(true);
    expect(updateTenantRequestSchema.safeParse({ name: "Acme", timezone: "Europe/Madrid" }).success).toBe(true);
  });
  it("requires at least one key", () => {
    expect(updateTenantRequestSchema.safeParse({}).success).toBe(false);
  });
  it("rejects unknown zones, long zones and extra keys", () => {
    expect(updateTenantRequestSchema.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(updateTenantRequestSchema.safeParse({ timezone: "A".repeat(65) }).success).toBe(false);
    expect(updateTenantRequestSchema.safeParse({ timezone: "America/Lima", slug: "x" }).success).toBe(false);
  });
});
