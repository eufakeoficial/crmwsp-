import { RateLimitedError, ValidationError } from "@crmwsp/contracts";
import type { MailMessage } from "@crmwsp/mailer";
import { describe, expect, it } from "vitest";
import { MemoryCounterStore } from "../../common/rate-limit-store.js";
import type { AuthRepository } from "../auth.repository.js";
import { AuthService, PASSWORD_RESET_TTL_SECONDS } from "../auth.service.js";
import { DEFAULT_ACCOUNT_BACKOFF } from "../rate-limiter.js";
import { hashSessionToken } from "../session-token.js";

const client = { ip: "10.0.0.1", userAgent: "vitest" };
const flush = () => new Promise((r) => setTimeout(r, 10));

/** In-memory twin of the 0074 functions: hashed single-use tokens with expiry. */
function setup(limit = 10) {
  const tokens = new Map<string, { userId: string; expiresAt: number; used: boolean }>();
  const passwords = new Map<string, string>();
  const sent: MailMessage[] = [];
  const calls: { ttl: number; hash: Buffer }[] = [];
  let now = 0;
  const repo = {
    async requestPasswordReset(email: string, hash: Buffer, ttl: number) {
      calls.push({ ttl, hash });
      if (email !== "ana@x.test") return undefined;
      for (const t of tokens.values()) if (t.userId === "u1") t.used = true;
      tokens.set(hash.toString("hex"), { userId: "u1", expiresAt: now + ttl * 1000, used: false });
      return { userId: "u1", email, name: "Ana" };
    },
    async consumePasswordReset(hash: Buffer, passwordHash: string) {
      const t = tokens.get(hash.toString("hex"));
      if (!t || t.used || t.expiresAt <= now) return undefined;
      t.used = true;
      passwords.set(t.userId, passwordHash);
      return t.userId;
    },
    async listUserTenants() {
      return [];
    },
    async writeAuthAudit() {},
  } as unknown as AuthRepository;
  const store = new MemoryCounterStore();
  const service = new AuthService(repo, 3600, { limit, windowMs: 60_000 }, { limit: 100, windowMs: 60_000 }, store, DEFAULT_ACCOUNT_BACKOFF, {
    send: async (m) => {
      sent.push(m);
      return { messageId: "1" };
    },
  });
  return { service, sent, calls, passwords, advance: (ms: number) => (now += ms) };
}

const tokenFrom = (m: MailMessage | undefined) => /\/reset\/([A-Za-z0-9_-]{43})/.exec(m?.text ?? "")?.[1] ?? "";

describe("password reset", () => {
  it("is enumeration-safe: unknown emails resolve the same and send nothing", async () => {
    const { service, sent, calls } = setup();
    await expect(service.forgotPassword({ email: "nobody@x.test" }, client)).resolves.toBeUndefined();
    await flush();
    expect(sent).toHaveLength(0);
    expect(calls).toHaveLength(1); // a token hash is generated either way
  });

  it("emails a 30-minute link whose token is only stored hashed", async () => {
    const { service, sent, calls } = setup();
    await service.forgotPassword({ email: "ana@x.test" }, client);
    await flush();
    expect(sent[0]?.subject).toBe("Restablece tu contraseña");
    expect(sent[0]?.text).toContain("30 minutos");
    const token = tokenFrom(sent[0]);
    expect(token).toHaveLength(43);
    expect(calls[0]?.ttl).toBe(PASSWORD_RESET_TTL_SECONDS);
    expect(calls[0]?.hash.equals(hashSessionToken(token))).toBe(true);
    expect(calls[0]?.hash.toString("hex")).not.toContain(token);
  });

  it("a token works once; reuse is rejected", async () => {
    const { service, sent, passwords } = setup();
    await service.forgotPassword({ email: "ana@x.test" }, client);
    await flush();
    const token = tokenFrom(sent[0]);
    await service.resetPassword({ token, password: "una-clave-nueva-1" }, client);
    expect(passwords.get("u1")).toMatch(/^scrypt\$/);
    await expect(service.resetPassword({ token, password: "otra-clave-nueva-2" }, client)).rejects.toBeInstanceOf(ValidationError);
  });

  it("an expired token is rejected", async () => {
    const { service, sent, advance } = setup();
    await service.forgotPassword({ email: "ana@x.test" }, client);
    await flush();
    advance(PASSWORD_RESET_TTL_SECONDS * 1000 + 1);
    await expect(service.resetPassword({ token: tokenFrom(sent[0]), password: "una-clave-nueva-1" }, client)).rejects.toBeInstanceOf(ValidationError);
  });

  it("is rate limited per IP and email", async () => {
    const { service } = setup(2);
    await service.forgotPassword({ email: "nobody@x.test" }, client);
    await service.forgotPassword({ email: "nobody@x.test" }, client);
    await expect(service.forgotPassword({ email: "nobody@x.test" }, client)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("a failing mailer never fails the request", async () => {
    const { service } = setup();
    (service as unknown as { mailer: { send: () => Promise<never> } }).mailer = { send: async () => Promise.reject(new Error("smtp")) };
    await expect(service.forgotPassword({ email: "ana@x.test" }, client)).resolves.toBeUndefined();
    await flush();
  });
});
