import { describe, expect, it } from "vitest";
import { loginRequestSchema, signupRequestSchema, tenantSlugSchema } from "../index.js";

const valid = {
  email: "  Ana@Example.COM ",
  name: "Ana",
  password: "correct-horse-1",
  tenantName: "Reformas Ana",
  tenantSlug: "Reformas-Ana",
};

describe("auth schemas", () => {
  it("normalizes email and slug", () => {
    const parsed = signupRequestSchema.parse(valid);
    expect(parsed.email).toBe("ana@example.com");
    expect(parsed.tenantSlug).toBe("reformas-ana");
  });
  it("rejects passwords shorter than 10 chars on signup", () => {
    expect(signupRequestSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
  });
  it("rejects invalid emails and slugs", () => {
    expect(signupRequestSchema.safeParse({ ...valid, email: "nope" }).success).toBe(false);
    for (const slug of ["a", "-abc", "abc-", "ab_c", "x".repeat(64)]) {
      expect(tenantSlugSchema.safeParse(slug).success).toBe(false);
    }
  });
  it("login accepts any non-empty password", () => {
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "x" }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});
