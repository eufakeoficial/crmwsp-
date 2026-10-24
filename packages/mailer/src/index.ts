import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Overrides the default sender (e.g. "Vende+ WSP <contacto@vendemas.chat>"). */
  from?: string;
  /** RFC 5322 Message-ID to use (`<id@domain>`), so replies can be threaded. */
  messageId?: string;
  /** Threading headers for replies (`<id@domain>` values). */
  inReplyTo?: string;
  references?: string[];
}

/** Rejects header-injection characters in values that become mail headers. */
export function assertSafeHeaderValue(value: string): void {
  if (/[\r\n\0]/.test(value) || value.length > 998) throw new MailerError("unsafe header value");
}

export interface Mailer {
  send(message: MailMessage): Promise<{ messageId: string }>;
}

export class MailerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "MailerError";
  }
}

export interface MailerLogger {
  info(message: string): void;
}

const TIMEOUT_MS = 10_000;

function domainOf(address: string): string {
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : "unknown";
}

export interface SmtpMailerOptions {
  from: string;
  /** Inject a prebuilt transporter (tests). Otherwise built from `smtp`. */
  transport?: Transporter;
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string };
}

export class SmtpMailer implements Mailer {
  private readonly transport: Transporter;
  private readonly from: string;

  constructor(options: SmtpMailerOptions) {
    this.from = options.from;
    if (options.transport) {
      this.transport = options.transport;
    } else if (options.smtp) {
      const { host, port, secure, user, password } = options.smtp;
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure,
        ...(user ? { auth: { user, pass: password ?? "" } } : {}),
        connectionTimeout: TIMEOUT_MS,
        greetingTimeout: TIMEOUT_MS,
        socketTimeout: TIMEOUT_MS,
      });
    } else {
      throw new MailerError("SmtpMailer requires smtp options or a transport");
    }
  }

  async send(message: MailMessage): Promise<{ messageId: string }> {
    for (const v of [message.from, message.messageId, message.inReplyTo, message.to, message.subject, ...(message.references ?? [])]) {
      if (v !== undefined) assertSafeHeaderValue(v);
    }
    try {
      const info = (await this.transport.sendMail({
        from: message.from ?? this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.messageId ? { messageId: message.messageId } : {}),
        ...(message.inReplyTo ? { inReplyTo: message.inReplyTo } : {}),
        ...(message.references?.length ? { references: message.references } : {}),
      })) as { messageId?: string };
      return { messageId: String(info.messageId ?? "") };
    } catch (err) {
      // Never include credentials/body: only the error class and code.
      const code = (err as { code?: string } | null)?.code;
      throw new MailerError(`email send failed${code ? ` (${code})` : ""}`, { cause: err });
    }
  }
}

export class NoopMailer implements Mailer {
  constructor(private readonly logger: MailerLogger = console) {}

  async send(message: MailMessage): Promise<{ messageId: string }> {
    this.logger.info(`mailer disabled (SMTP_HOST unset); skipped email to domain ${domainOf(message.to)}`);
    return { messageId: "noop" };
  }
}

export function createMailerFromEnv(
  env: Record<string, string | undefined> = process.env,
  logger: MailerLogger = console,
): Mailer {
  const host = env.SMTP_HOST?.trim();
  if (!host) return new NoopMailer(logger);
  const port = Number(env.SMTP_PORT ?? 587);
  if (!Number.isInteger(port) || port <= 0) throw new MailerError("SMTP_PORT is invalid");
  return new SmtpMailer({
    from: env.MAIL_FROM?.trim() || "CRMWSP <no-reply@localhost>",
    smtp: {
      host,
      port,
      secure: env.SMTP_SECURE === "true" || env.SMTP_SECURE === "1",
      ...(env.SMTP_USER ? { user: env.SMTP_USER } : {}),
      ...(env.SMTP_PASSWORD ? { password: env.SMTP_PASSWORD } : {}),
    },
  });
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailTemplateInput {
  title: string;
  body: string;
  ctaLabel?: string;
  ctaUrl?: string;
}

/** Tiny Spanish transactional template. Only http(s) CTA URLs are rendered. */
export function renderEmail(input: EmailTemplateInput): { text: string; html: string } {
  const cta = input.ctaLabel && input.ctaUrl && /^https?:\/\//i.test(input.ctaUrl) ? { label: input.ctaLabel, url: input.ctaUrl } : null;
  const text = [input.title, "", input.body, ...(cta ? ["", `${cta.label}: ${cta.url}`] : []), "", "— CRMWSP"].join("\n");
  const paragraphs = input.body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const button = cta
    ? `<p style="margin:20px 0"><a href="${escapeHtml(cta.url)}" style="background:#16a34a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(cta.label)}</a></p>`
    : "";
  const html = `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:16px"><h2 style="margin:0 0 16px">${escapeHtml(input.title)}</h2>${paragraphs}${button}<p style="color:#666;font-size:12px;margin-top:24px">CRMWSP</p></body></html>`;
  return { text, html };
}

export * from "./resend.js";
