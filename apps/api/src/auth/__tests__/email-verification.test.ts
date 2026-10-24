import { RateLimitedError, ValidationError } from "@crmwsp/contracts";
import { EMAIL_VERIFICATION_TTL_SECONDS } from "@crmwsp/domain";
import type { MailMessage } from "@crmwsp/mailer";
import { describe, expect, it } from "vitest";
import { MemoryCounterStore } from "../../common/rate-limit-store.js";
import type { AuthRepository } from "../auth.repository.js";
import { AuthService } from "../auth.service.js";
import { DEFAULT_ACCOUNT_BACKOFF } from "../rate-limiter.js";
import { hashSessionToken } from "../session-token.js";

const client = { ip: "10.0.0.1", userAgent: "vitest" };
const flush = () => new Promise((r) => setTimeout(r, 10));
const user = { id: "u1", email: "ana@x.test", name: "Ana" };

/** In-memory twin of the 0095 functions: hashed single-use 24h tokens. */
function setup() {
  const tokens = new Map<string, { userId: string; expiresAt: number; used: boolean }>();
  let verified = false;
  let now = 0;
  const sent: MailMessage[] = [];
  const calls: { ttl: number; hash: Buffer }[] = [];
  const repo = {
    async issueEmailVerification(userId: string, hash: Buffer, ttl: number) {
      calls.push({ ttl, hash });
      if (verified) return undefined;
      for (const t of tokens.values()) if (t.userId === userId) t.used = true;
      tokens.set(hash.toString("hex"), { userId, expiresAt: now + ttl * 1000, used: false });
      return { userId, email: user.email, name: user.name };
    },
    async consumeEmailVerification(hash: Buffer) {
      const t = tokens.get(hash.toString("hex"));
      if (!t || t.used || t.expiresAt <= now) return undefined;
      t.used = true;
      verified = true;
      return t.userId;
    },
    async isEmailVerified() {
      return verified;
    },
    async listUserTenants() {
      return [];
    },
    async writeAuthAudit() {},
  } as unknown as AuthRepository;
  const service = new AuthService(repo, 3600, { limit: 10, windowMs: 60_000 }, { limit: 100, windowMs: 60_000 }, new MemoryCounterStore(), DEFAULT_ACCOUNT_BACKOFF, {
    send: async (m) => {
      sent.push(m);
      return { messageId: "1" };
    },
  });
  return { service, sent, calls, advance: (ms: number) => (now += ms) };
}

const tokenFrom = (m: MailMessage | undefined) => /\/verify\/([A-Za-z0-9_-]{43})/.exec(m?.text ?? "")?.[1] ?? "";

describe("email verification", () => {
  it("mails a 24-hour link whose token is only stored hashed", async () => {
    const { service, sent, calls } = setup();
    await service.resendVerification(user, client);
    await flush();
    expect(sent[0]?.subject).toContain("Confirma tu cuenta");
    expect(sent[0]?.text).toContain("24 horas");
    const token = tokenFrom(sent[0]);
    expect(token).toHaveLength(43);
    expect(calls[0]?.ttl).toBe(EMAIL_VERIFICATION_TTL_SECONDS);
    expect(calls[0]?.hash.equals(hashSessionToken(token))).toBe(true);
  });

  it("a token verifies once; reuse is rejected and /me reports verified", async () => {
    const { service, sent } = setup();
    expect((await service.me(user)).user.emailVerified).toBe(false);
    await service.resendVerification(user, client);
    await flush();
    const token = tokenFrom(sent[0]);
    await service.verifyEmail({ token }, client);
    expect((await service.me(user)).user.emailVerified).toBe(true);
    await expect(service.verifyEmail({ token }, client)).rejects.toBeInstanceOf(ValidationError);
  });

  it("an expired token is rejected", async () => {
    const { service, sent, advance } = setup();
    await service.resendVerification(user, client);
    await flush();
    advance(EMAIL_VERIFICATION_TTL_SECONDS * 1000);
    await expect(service.verifyEmail({ token: tokenFrom(sent[0]) }, client)).rejects.toBeInstanceOf(ValidationError);
  });

  it("a resend invalidates the previous link", async () => {
    const { service, sent } = setup();
    await service.resendVerification(user, client);
    await service.resendVerification(user, client);
    await flush();
    await expect(service.verifyEmail({ token: tokenFrom(sent[0]) }, client)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.verifyEmail({ token: tokenFrom(sent[1]) }, client)).resolves.toBeUndefined();
  });

  it("resends are capped at 3 per hour per user", async () => {
    const { service } = setup();
    for (let i = 0; i < 3; i++) await service.resendVerification(user, client);
    await expect(service.resendVerification(user, client)).rejects.toBeInstanceOf(RateLimitedError);
  });
});
