import { describe, expect, it } from "vitest";
import {
  EMAIL_VERIFICATION_RESEND_LIMIT,
  EMAIL_VERIFICATION_TTL_HOURS,
  EMAIL_VERIFICATION_TTL_SECONDS,
  emailAllowsWhatsAppConnect,
  emailVerificationTokenState,
} from "./index.js";

const created = new Date("2026-01-01T00:00:00Z");
const expiresAt = new Date(created.getTime() + EMAIL_VERIFICATION_TTL_SECONDS * 1000);

describe("email verification token", () => {
  it("lives 24 hours", () => {
    expect(EMAIL_VERIFICATION_TTL_HOURS).toBe(24);
    expect(EMAIL_VERIFICATION_TTL_SECONDS).toBe(86_400);
  });

  it("is valid before expiry and unused", () => {
    expect(emailVerificationTokenState({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() - 1))).toBe("valid");
  });

  it("is expired at or after expiresAt", () => {
    expect(emailVerificationTokenState({ expiresAt, usedAt: null }, expiresAt)).toBe("expired");
    expect(emailVerificationTokenState({ expiresAt, usedAt: null }, new Date(expiresAt.getTime() + 1))).toBe("expired");
  });

  it("is single use: a used token is never valid again", () => {
    expect(emailVerificationTokenState({ expiresAt, usedAt: created }, created)).toBe("used");
  });

  it("caps resends at 3 per hour", () => {
    expect(EMAIL_VERIFICATION_RESEND_LIMIT).toEqual({ limit: 3, windowMs: 3_600_000 });
  });
});

describe("emailAllowsWhatsAppConnect", () => {
  it("requires the tenant owner's verified email", () => {
    expect(emailAllowsWhatsAppConnect({ ownerEmailVerified: true })).toBe(true);
    expect(emailAllowsWhatsAppConnect({ ownerEmailVerified: false })).toBe(false);
  });
});
