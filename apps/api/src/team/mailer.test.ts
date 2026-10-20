import { createServer, type AddressInfo, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { invitationEmail, newInvitationToken, hashInvitationToken } from "./invitation-token.js";
import { buildMessage, SmtpMailer } from "./mailer.js";

describe("mailer", () => {
  it("rejects header injection in addresses and subject", () => {
    expect(() => buildMessage("a@x.test", { to: "b@x.test\r\nBcc: c@x.test", subject: "s", text: "t" })).toThrow();
    expect(() => buildMessage("a@x.test", { to: "b@x.test", subject: "s\r\nBcc: c@x.test", text: "t" })).toThrow();
  });

  it("encodes non-ASCII subjects and base64 bodies", () => {
    const m = buildMessage("a@x.test", { to: "b@x.test", subject: "Invitación", text: "Hola\n.\n" });
    expect(m).toContain("Subject: =?UTF-8?B?");
    expect(m).toContain("Content-Transfer-Encoding: base64");
    expect(m).not.toContain("\r\n.\r\n");
  });

  describe("SMTP dialogue", () => {
    let server: Server;
    let received = "";
    beforeAll(async () => {
      server = createServer((sock) => {
        sock.write("220 test\r\n");
        let inData = false;
        sock.on("data", (d) => {
          const s = d.toString();
          received += s;
          if (inData) {
            if (received.endsWith("\r\n.\r\n")) {
              inData = false;
              sock.write("250 queued\r\n");
            }
            return;
          }
          if (s.startsWith("EHLO")) sock.write("250-test\r\n250 SIZE 1000\r\n");
          else if (s.startsWith("DATA")) {
            inData = true;
            sock.write("354 go\r\n");
          } else if (s.startsWith("QUIT")) sock.end("221 bye\r\n");
          else sock.write("250 ok\r\n");
        });
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    });
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("sends one message through a plain SMTP server (Mailpit-like)", async () => {
      const port = (server.address() as AddressInfo).port;
      await new SmtpMailer({ host: "127.0.0.1", port, from: "no-reply@x.test", secure: false }).send({ to: "b@x.test", subject: "Hola", text: "cuerpo" });
      expect(received).toContain("MAIL FROM:<no-reply@x.test>");
      expect(received).toContain("RCPT TO:<b@x.test>");
    });
  });
});

describe("invitation token", () => {
  it("is 43 base64url chars and only its SHA-256 is derived", () => {
    const { token, hash } = newInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toHaveLength(32);
    expect(hashInvitationToken(token).equals(hash)).toBe(true);
  });

  it("builds a Spanish email with the link", () => {
    const e = invitationEmail({ tenantName: "Acme", role: "agent", inviterName: "Olga", link: "https://w/invite/x" });
    expect(e.subject).toBe("Invitación para unirte a Acme");
    expect(e.text).toContain("Olga te ha invitado");
    expect(e.text).toContain("como Agente");
    expect(e.text).toContain("https://w/invite/x");
  });
});
