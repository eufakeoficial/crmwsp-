import { ForbiddenError, RateLimitedError } from "@crmwsp/contracts";
import { describe, expect, it, vi } from "vitest";
import { MemoryCounterStore } from "../common/rate-limit-store.js";
import { StoreRateLimiter } from "../auth/rate-limiter.js";
import { REVEAL_API_KEY_LIMIT, REVEAL_API_KEY_WINDOW_MS, revealApiKey, type RevealDeps } from "./api-key-reveal.js";

const KEY = "sk_live_super_secret_key_123";
const input = { tenantId: "t1", userId: "u1", email: "o@x.test", password: "pw-ok" };

function deps(over: Partial<RevealDeps> = {}): RevealDeps & { audits: unknown[] } {
  const limiter = new StoreRateLimiter({ limit: REVEAL_API_KEY_LIMIT, windowMs: REVEAL_API_KEY_WINDOW_MS }, new MemoryCounterStore(), "t");
  const audits: unknown[] = [];
  return {
    audits,
    hit: (k) => limiter.hit(k),
    loadPasswordHash: async () => "hash",
    dummyHash: async () => "dummy",
    verifyPassword: async (stored, pw) => stored === "hash" && pw === "pw-ok",
    decrypt: () => KEY,
    auditFailure: async (reason) => void audits.push({ action: "failed", reason }),
    auditSuccess: async () => void audits.push({ action: "revealed" }),
    ...over,
  };
}

describe("revealApiKey", () => {
  it("returns the key with a 30s ttl and audits without the key", async () => {
    const d = deps();
    await expect(revealApiKey(d, input)).resolves.toEqual({ apiKey: KEY, expiresInSeconds: 30 });
    expect(d.audits).toEqual([{ action: "revealed" }]);
    expect(JSON.stringify(d.audits)).not.toContain(KEY);
  });

  it("wrong password: 403 generic, audited, never decrypts", async () => {
    const decrypt = vi.fn(() => KEY);
    const d = deps({ decrypt });
    const err = await revealApiKey(d, { ...input, password: "bad" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ForbiddenError);
    expect((err as Error).message).not.toMatch(/password|contraseña/i);
    expect(decrypt).not.toHaveBeenCalled();
    expect(d.audits).toEqual([{ action: "failed", reason: "wrong_password" }]);
    expect(JSON.stringify(d.audits)).not.toContain("bad");
  });

  it("user without a password hash still runs a dummy verification and fails", async () => {
    const verify = vi.fn(async () => true);
    const d = deps({ loadPasswordHash: async () => undefined, verifyPassword: verify });
    await expect(revealApiKey(d, input)).rejects.toBeInstanceOf(ForbiddenError);
    expect(verify).toHaveBeenCalledWith("dummy", "pw-ok");
  });

  it("counts successes and failures: the 6th attempt in the hour is 429", async () => {
    const d = deps();
    await revealApiKey(d, input);
    await revealApiKey(d, { ...input, password: "bad" }).catch(() => undefined);
    await revealApiKey(d, input);
    await revealApiKey(d, { ...input, password: "bad" }).catch(() => undefined);
    await revealApiKey(d, input);
    await expect(revealApiKey(d, input)).rejects.toBeInstanceOf(RateLimitedError);
    expect(d.audits.at(-1)).toEqual({ action: "failed", reason: "rate_limited" });
    // Other users / tenants are independent.
    await expect(revealApiKey(d, { ...input, userId: "u2" })).resolves.toMatchObject({ apiKey: KEY });
    await expect(revealApiKey(d, { ...input, tenantId: "t2" })).resolves.toMatchObject({ apiKey: KEY });
  });
});
