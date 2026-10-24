import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import {
  ExternalProviderError,
  NotFoundError,
  RateLimitedError,
  ValidationError,
  type SupportEmailFolder,
  type SupportEmailThread,
  type SupportEmailThreadSummary,
} from "@crmwsp/contracts";
import { EMAIL_OUTBOUND_HOURLY_LIMIT, buildReferences, isPlainEmail, replySubject } from "@crmwsp/domain";
import { PLATFORM_INBOX_ADDRESS, PLATFORM_INBOX_FROM, escapeHtml, type Mailer, type ResendReceivingClient } from "@crmwsp/mailer";
import { type CounterStore, defaultRateLimitStore } from "../common/rate-limit-store.js";
import { RealtimeHub } from "../events/realtime.hub.js";
import { PlatformEmailRepository } from "./platform-email.repository.js";

export const PLATFORM_EMAIL_MAILER = Symbol("PLATFORM_EMAIL_MAILER");
export const PLATFORM_EMAIL_RESEND = Symbol("PLATFORM_EMAIL_RESEND");
export const PLATFORM_EMAIL_COUNTER = Symbol("PLATFORM_EMAIL_COUNTER");

const MESSAGE_DOMAIN = "vendemas.chat";
const HOUR_MS = 3_600_000;
/** Attachment proxy cap (bytes). */
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

function bodyHtml(body: string): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<!doctype html><html lang="es"><body style="font-family:Arial,sans-serif;color:#111;max-width:620px;padding:8px">${paragraphs}<p style="color:#666;font-size:12px;margin-top:20px">Vende+ WSP · ${PLATFORM_INBOX_ADDRESS}</p></body></html>`;
}

export interface AttachmentDownload {
  filename: string;
  contentType: string;
  body: Buffer;
}

/**
 * Platform email inbox (ADR 0020). Replies go out FROM contacto@vendemas.chat through the
 * existing mailer with In-Reply-To/References so the customer's client threads them, and are
 * recorded (and audited) only after the mailer accepted them. Never sends automatically.
 */
@Injectable()
export class PlatformEmailService {
  private readonly logger = new Logger(PlatformEmailService.name);

  constructor(
    @Inject(PlatformEmailRepository) private readonly repo: PlatformEmailRepository,
    @Inject(RealtimeHub) private readonly hub: Pick<RealtimeHub, "publish" | "publishPlatformSupport">,
    @Inject(PLATFORM_EMAIL_MAILER) private readonly mailer: Mailer,
    @Optional() @Inject(PLATFORM_EMAIL_RESEND) private readonly resend: Pick<ResendReceivingClient, "getAttachmentDownloadUrl"> | null = null,
    @Optional() @Inject(PLATFORM_EMAIL_COUNTER) private readonly counter: CounterStore = defaultRateLimitStore(),
    @Optional() @Inject("PLATFORM_EMAIL_FETCH") private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  list(actor: string, folder: SupportEmailFolder): Promise<SupportEmailThreadSummary[]> {
    return this.repo.list(actor, folder);
  }

  unreadCount(actor: string): Promise<number> {
    return this.repo.unreadCount(actor);
  }

  async thread(actor: string, ticketId: string, markRead: boolean): Promise<SupportEmailThread> {
    if (markRead) await this.repo.markRead(actor, ticketId);
    const [thread, messages] = await Promise.all([this.repo.get(actor, ticketId), this.repo.messages(actor, ticketId)]);
    return { thread, messages: messages.map(({ emailMessageId: _m, storedAttachments: _s, ...m }) => m) };
  }

  private async notify(ticketId: string, tenantId: string | null): Promise<void> {
    const event = { type: "support.ticket_updated", ticketId } as const;
    await Promise.all([this.hub.publishPlatformSupport(event), tenantId ? this.hub.publish(tenantId, event) : Promise.resolve()]);
  }

  private async chargeOutbound(actor: string): Promise<void> {
    const n = await this.counter.incr(`email-out:${actor}`, HOUR_MS);
    if (n > EMAIL_OUTBOUND_HOURLY_LIMIT) throw new RateLimitedError("Too many emails sent; try again later");
  }

  private async send(to: string, subject: string, body: string, threading: { inReplyTo?: string; references?: string[] }): Promise<string> {
    const messageId = `<${randomUUID()}@${MESSAGE_DOMAIN}>`;
    try {
      await this.mailer.send({
        from: PLATFORM_INBOX_FROM,
        replyTo: PLATFORM_INBOX_ADDRESS,
        to,
        subject,
        text: `${body}\n\n— Vende+ WSP · ${PLATFORM_INBOX_ADDRESS}`,
        html: bodyHtml(body),
        messageId,
        ...(threading.inReplyTo ? { inReplyTo: threading.inReplyTo } : {}),
        ...(threading.references?.length ? { references: threading.references } : {}),
      });
    } catch (err) {
      this.logger.warn(`platform email send failed (${err instanceof Error ? err.name : "unknown"})`);
      throw new ExternalProviderError("smtp", "Email could not be sent");
    }
    return messageId;
  }

  async reply(actor: string, ticketId: string, body: string, ip: string | null): Promise<SupportEmailThread> {
    const [thread, messages] = await Promise.all([this.repo.get(actor, ticketId), this.repo.messages(actor, ticketId)]);
    const to = thread.contactEmail;
    if (!to || !isPlainEmail(to)) throw new ValidationError("Thread has no valid recipient");
    await this.chargeOutbound(actor);
    const chain = messages.filter((m) => m.direction !== "note" && m.emailMessageId).map((m) => m.emailMessageId as string);
    const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound" && m.emailMessageId)?.emailMessageId ?? null;
    const references = buildReferences(chain.filter((id) => id !== lastInbound), lastInbound);
    const subject = replySubject(thread.subject, thread.number);
    const messageId = await this.send(to, subject, body, { ...(lastInbound ? { inReplyTo: lastInbound } : {}), references });
    const rec = await this.repo.recordOutbound(actor, ticketId, to, subject, body, messageId, ip);
    await this.notify(rec.ticketId, rec.tenantId);
    return this.thread(actor, ticketId, false);
  }

  async compose(actor: string, to: string, subject: string, body: string, ip: string | null): Promise<SupportEmailThread> {
    if (!isPlainEmail(to)) throw new ValidationError("Invalid recipient");
    if (to.endsWith(`@${MESSAGE_DOMAIN}`)) throw new ValidationError("Cannot send to the platform domain");
    await this.chargeOutbound(actor);
    const messageId = await this.send(to, subject, body, {});
    const rec = await this.repo.recordOutbound(actor, null, to, subject, body, messageId, ip);
    await this.notify(rec.ticketId, rec.tenantId);
    return this.thread(actor, rec.ticketId, false);
  }

  /**
   * Attachment bytes, proxied: the attachment must belong to this thread (checked through the
   * admin-gated messages function) and the download URL comes from Resend's API, never from the
   * client, so there is no open redirect / SSRF surface.
   */
  async attachment(actor: string, ticketId: string, attachmentId: string): Promise<AttachmentDownload> {
    if (!this.resend) throw new ExternalProviderError("resend", "Attachments are not configured");
    const messages = await this.repo.messages(actor, ticketId);
    const found = messages.flatMap((m) => m.storedAttachments).find((a) => a.id === attachmentId);
    if (!found) throw new NotFoundError();
    if (found.size !== null && found.size > ATTACHMENT_MAX_BYTES) throw new ValidationError("Attachment too large");
    const link = await this.resend.getAttachmentDownloadUrl(found.emailId, found.id).catch(() => {
      throw new ExternalProviderError("resend", "Attachment unavailable");
    });
    const res = await this.fetchImpl(link.url, { signal: AbortSignal.timeout(20_000), redirect: "error" });
    if (!res.ok || !res.body) throw new ExternalProviderError("resend", "Attachment unavailable");
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > ATTACHMENT_MAX_BYTES) throw new ValidationError("Attachment too large");
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > ATTACHMENT_MAX_BYTES) throw new ValidationError("Attachment too large");
    return { filename: found.filename, contentType: found.contentType, body: buf };
  }
}
