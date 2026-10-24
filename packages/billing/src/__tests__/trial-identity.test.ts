import { describe, expect, it } from "vitest";
import { initialLifecycle, startTrial, tenantAccess, applyTenantAccess, PLANS } from "../index.js";
import { trialIdentityHash } from "../trial-identity.js";

const SECRET = "s".repeat(32);

describe("trialIdentityHash", () => {
  it("is a stable HMAC-SHA256 hex of the normalized phone, never the plaintext", () => {
    const a = trialIdentityHash(SECRET, "phone", "+591 700-00001");
    const b = trialIdentityHash(SECRET, "phone", "+59170000001");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("59170000001");
  });
  it("depends on the secret and the identity type", () => {
    const a = trialIdentityHash(SECRET, "phone", "+59170000001");
    expect(trialIdentityHash("t".repeat(32), "phone", "+59170000001")).not.toBe(a);
    expect(trialIdentityHash(SECRET, "waba", "+59170000001")).not.toBe(a);
  });
  it("rejects a missing/short secret and empty identities", () => {
    expect(() => trialIdentityHash("short", "phone", "+59170000001")).toThrow();
    expect(() => trialIdentityHash(SECRET, "phone", "  ")).toThrow();
  });
});

describe("trial denied (number already used its free trial)", () => {
  const signup = new Date("2026-11-01T00:00:00Z");
  const denied = { ...initialLifecycle(signup), trialDeniedAt: new Date("2026-11-02T00:00:00Z") };
  it("goes straight to payment_required, restricted-like, until paid", () => {
    expect(tenantAccess(null, denied, new Date("2026-11-03T00:00:00Z"))).toBe("payment_required");
    expect(applyTenantAccess(PLANS.start, "payment_required").limits.ai_messages).toBe(0);
    expect(tenantAccess("2026-12-30", denied, new Date("2026-11-03T00:00:00Z"))).toBe("active");
    expect(startTrial(denied, new Date("2026-11-03T00:00:00Z"))).toBeNull();
  });
});
