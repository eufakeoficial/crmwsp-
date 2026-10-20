import { Logger } from "@nestjs/common";
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect } from "node:tls";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** Outbound email. Implementations must never log message bodies (they carry one-time links). */
export interface Mailer {
  send(msg: MailMessage): Promise<void>;
}

export const MAILER = Symbol("MAILER");

export interface SmtpConfig {
  host: string;
  port: number;
  from: string;
  /** Implicit TLS (port 465). Plain SMTP is only for local Mailpit. */
  secure: boolean;
  user?: string | undefined;
  pass?: string | undefined;
  timeoutMs?: number;
}

const ADDRESS_RE = /^[^\s<>"\r\n@]+@[^\s<>"\r\n@]+$/;

function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** RFC 5322 message, text/plain UTF-8 in base64 (no dot-stuffing or 8-bit issues). */
export function buildMessage(from: string, msg: MailMessage, now = new Date()): string {
  if (!ADDRESS_RE.test(from) || !ADDRESS_RE.test(msg.to)) throw new Error("invalid email address");
  if (/[\r\n]/.test(msg.subject)) throw new Error("invalid subject");
  const body = Buffer.from(msg.text, "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n");
  return [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    `Date: ${now.toUTCString()}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    body,
  ].join("\r\n");
}

/** Minimal SMTP client (no dependency): EHLO, optional AUTH PLAIN over TLS, one message. */
export class SmtpMailer implements Mailer {
  constructor(private readonly config: SmtpConfig) {}

  async send(msg: MailMessage): Promise<void> {
    const data = buildMessage(this.config.from, msg);
    const socket: Socket = this.config.secure
      ? tlsConnect({ host: this.config.host, port: this.config.port, servername: this.config.host })
      : netConnect({ host: this.config.host, port: this.config.port });
    socket.setTimeout(this.config.timeoutMs ?? 10_000);
    const reader = replyReader(socket);
    try {
      await reader.expect(220);
      socket.write("EHLO crmwsp\r\n");
      await reader.expect(250);
      if (this.config.user && this.config.pass) {
        if (!this.config.secure) throw new Error("SMTP auth requires TLS");
        const plain = Buffer.from(`\0${this.config.user}\0${this.config.pass}`, "utf8").toString("base64");
        socket.write(`AUTH PLAIN ${plain}\r\n`);
        await reader.expect(235);
      }
      socket.write(`MAIL FROM:<${this.config.from}>\r\n`);
      await reader.expect(250);
      socket.write(`RCPT TO:<${msg.to}>\r\n`);
      await reader.expect(250, 251);
      socket.write("DATA\r\n");
      await reader.expect(354);
      socket.write(`${data}\r\n.\r\n`);
      await reader.expect(250);
      socket.write("QUIT\r\n");
    } finally {
      socket.end();
      socket.destroy();
    }
  }
}

function replyReader(socket: Socket) {
  let buffer = "";
  let waiter: { resolve: (code: number) => void; reject: (e: Error) => void } | undefined;
  let failure: Error | undefined;
  const replies: number[] = [];
  const flush = () => {
    if (!waiter) return;
    if (replies.length) waiter.resolve(replies.shift()!);
    else if (failure) waiter.reject(failure);
    else return;
    waiter = undefined;
  };
  socket.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = buffer.indexOf("\r\n")) !== -1) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // Final line of a (possibly multi-line) reply: "250 ok" (a "250-..." line continues).
      if (/^\d{3}( |$)/.test(line)) replies.push(Number(line.slice(0, 3)));
    }
    flush();
  });
  const fail = (e: Error) => {
    failure ??= e;
    flush();
  };
  socket.on("error", (e) => fail(new Error(`SMTP connection error: ${(e as NodeJS.ErrnoException).code ?? "unknown"}`)));
  socket.on("timeout", () => fail(new Error("SMTP timeout")));
  socket.on("close", () => fail(new Error("SMTP connection closed")));
  return {
    expect: (...codes: number[]): Promise<void> =>
      new Promise<number>((resolve, reject) => {
        waiter = { resolve, reject };
        flush();
      }).then((code) => {
        // Never echo the server text: it may quote addresses.
        if (!codes.includes(code)) throw new Error(`SMTP unexpected reply ${code}`);
      }),
  };
}

/** Used when SMTP_HOST is not set: the invitation is still created and can be resent later. */
export class DisabledMailer implements Mailer {
  private readonly logger = new Logger("Mailer");
  send(): Promise<void> {
    this.logger.warn("SMTP_HOST not configured: email not sent");
    return Promise.resolve();
  }
}

/** SMTP_HOST, SMTP_PORT (1025 = local Mailpit), SMTP_FROM, SMTP_SECURE, SMTP_USER, SMTP_PASS. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): Mailer {
  const host = env["SMTP_HOST"]?.trim();
  if (!host) return new DisabledMailer();
  const secure = env["SMTP_SECURE"] === "true";
  return new SmtpMailer({
    host,
    port: Number(env["SMTP_PORT"] ?? (secure ? 465 : 1025)),
    from: env["SMTP_FROM"]?.trim() || "no-reply@crmwsp.local",
    secure,
    user: env["SMTP_USER"],
    pass: env["SMTP_PASS"],
  });
}
