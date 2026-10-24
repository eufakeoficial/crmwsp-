import nodemailer from "nodemailer";
import { describe, expect, it, vi } from "vitest";
import type { Transporter } from "nodemailer";
import { MailerError, NoopMailer, SmtpMailer, createMailerFromEnv, escapeHtml, parseResendReceivedEmail, templateMessage } from "../index.js";

describe("SmtpMailer", () => {
  it("sends through a transport and returns the messageId", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const mailer = new SmtpMailer({ from: "CRMWSP <no-reply@crmwsp.test>", transport });
    const res = await mailer.send({ to: "a@b.test", subject: "Hola", text: "cuerpo", html: "<p>x</p>", replyTo: "r@b.test" });
    expect(res.messageId).toBeTruthy();
  });

  it("wraps failures in MailerError without leaking the body", async () => {
    const transport = { sendMail: vi.fn().mockRejectedValue(Object.assign(new Error("secret-body boom"), { code: "ECONNECTION" })) };
    const mailer = new SmtpMailer({ from: "x@y.test", transport: transport as never });
    const err = await mailer.send({ to: "a@b.test", subject: "s", text: "secret-body" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MailerError);
    expect((err as Error).message).toBe("email send failed (ECONNECTION)");
  });
});

describe("createMailerFromEnv", () => {
  it("returns a Noop that logs only the recipient domain when SMTP_HOST is unset", async () => {
    const info = vi.fn();
    const mailer = createMailerFromEnv({}, { info });
    expect(mailer).toBeInstanceOf(NoopMailer);
    await mailer.send({ to: "persona@dominio.test", subject: "secreto", text: "cuerpo secreto" });
    const logged = String(info.mock.calls[0]?.[0]);
    expect(logged).toContain("dominio.test");
    expect(logged).not.toContain("persona");
    expect(logged).not.toContain("secreto");
  });

  it("builds an SmtpMailer when SMTP_HOST is set", () => {
    expect(createMailerFromEnv({ SMTP_HOST: "localhost", SMTP_PORT: "1025" })).toBeInstanceOf(SmtpMailer);
  });
});

describe("escapeHtml", () => {
  it("escapes quotes", () => {
    expect(escapeHtml("'")).toBe("&#39;");
  });
});

describe.skipIf(!process.env.SMTP_HOST)("Mailpit integration", () => {
  it("delivers a real email", async () => {
    const mailer = createMailerFromEnv();
    const res = await mailer.send(
      templateMessage("dest@crmwsp.test", "notificacion-generica", { title: "Prueba T26", body: "Hola desde Vende+", appUrl: "https://www.vendemas.chat/app" }, { siteUrl: "https://www.vendemas.chat", assetsUrl: "https://www.vendemas.chat/brand" }),
    );
    expect(res.messageId).toBeTruthy();
  });
});

describe("threading headers and resend parsing", () => {
  it("passes from/messageId/inReplyTo/references to the transport", async () => {
    const sent: Record<string, unknown>[] = [];
    const transport = { sendMail: async (m: Record<string, unknown>) => (sent.push(m), { messageId: "x" }) } as unknown as Transporter;
    const mailer = new SmtpMailer({ from: "d <d@x.co>", transport });
    await mailer.send({ to: "a@b.co", subject: "Re: hola", text: "t", from: "Vende+ WSP <contacto@vendemas.chat>", messageId: "<m@v>", inReplyTo: "<p@c>", references: ["<r@c>", "<p@c>"] });
    expect(sent[0]).toMatchObject({ from: "Vende+ WSP <contacto@vendemas.chat>", messageId: "<m@v>", inReplyTo: "<p@c>", references: ["<r@c>", "<p@c>"] });
  });
  it("rejects header injection", async () => {
    const transport = { sendMail: async () => ({ messageId: "x" }) } as unknown as Transporter;
    const mailer = new SmtpMailer({ from: "d <d@x.co>", transport });
    await expect(mailer.send({ to: "a@b.co", subject: "x\r\nBcc: e@v.il", text: "t" })).rejects.toBeInstanceOf(MailerError);
  });
  it("parses a received email", () => {
    const e = parseResendReceivedEmail({ id: "e1", from: "A <a@b.co>", to: ["contacto@vendemas.chat"], subject: "S", html: "<p>x</p>", text: null, message_id: "<m@b>", attachments: [{ id: "a1", filename: "f.pdf", content_type: "application/pdf", size: 10 }] });
    expect(e.messageId).toBe("<m@b>");
    expect(e.attachments).toEqual([{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 10 }]);
  });
});
