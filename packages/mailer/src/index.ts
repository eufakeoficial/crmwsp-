import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { BRAND, renderTemplate, type EmailContext, type EmailData, type EmailKey } from "./templates/index.js";

export * from "./templates/index.js";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Extra headers (e.g. RFC 8058 List-Unsubscribe for optional emails). */
  headers?: Record<string, string>;
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
    try {
      const info = (await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
        ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        ...(message.headers && Object.keys(message.headers).length ? { headers: message.headers } : {}),
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

/** Public brand assets served by apps/web (apps/web/public/brand). Emails need an absolute https URL. */
export const DEFAULT_EMAIL_ASSETS_URL = "https://www.vendemas.chat/brand";

const trimSlash = (v: string) => v.replace(/\/+$/, "");

/**
 * Template context from env: links point to PUBLIC_WEB_URL (or the first WEB_ORIGINS entry,
 * else the production site); the logo always loads from an absolute https URL
 * (EMAIL_ASSETS_URL when it is https, else DEFAULT_EMAIL_ASSETS_URL).
 */
export function emailContextFromEnv(env: Record<string, string | undefined> = process.env): EmailContext {
  const site = trimSlash((env.PUBLIC_WEB_URL ?? env.WEB_ORIGINS?.split(",")[0] ?? "").trim()) || BRAND.siteUrl;
  const assets = trimSlash(env.EMAIL_ASSETS_URL?.trim() ?? "");
  return { siteUrl: /^https?:\/\//i.test(site) ? site : BRAND.siteUrl, assetsUrl: /^https:\/\//i.test(assets) ? assets : DEFAULT_EMAIL_ASSETS_URL };
}

/** Joins the site URL and an absolute path. */
export function siteLink(ctx: EmailContext, path: string): string {
  return `${trimSlash(ctx.siteUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Renders a branded template into a ready-to-send message. */
export function templateMessage<K extends EmailKey>(to: string, key: K, data: EmailData<K>, ctx: EmailContext): MailMessage {
  const email = renderTemplate(key, data, ctx);
  return { to, subject: email.subject.slice(0, 200), text: email.text, html: email.html, ...(Object.keys(email.headers).length ? { headers: email.headers } : {}) };
}
