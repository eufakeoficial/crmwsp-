import { describe, expect, it } from "vitest";
import { hashInvitationToken, invitationEmail, newInvitationToken } from "./invitation-token.js";

describe("invitation token", () => {
  it("is 43 base64url chars and only its SHA-256 is derived", () => {
    const { token, hash } = newInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(32);
    expect(hashInvitationToken(token).equals(hash)).toBe(true);
  });

  it("builds a Spanish email with the link in text and html", () => {
    const e = invitationEmail({ tenantName: "Acme", role: "agent", inviterName: "Olga", link: "https://w/invite/x" });
    expect(e.subject).toBe("Invitación para unirte a Acme");
    expect(e.text).toContain("Olga te ha invitado");
    expect(e.text).toContain("como agente");
    expect(e.text).toContain("https://w/invite/x");
    expect(e.html).toContain("https://w/invite/x");
  });
});
