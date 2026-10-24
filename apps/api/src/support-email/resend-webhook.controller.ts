import { Controller, Inject, Logger, Optional, Post, Req, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import { verifySvixSignature } from "./svix-signature.js";
import { RESEND_EVENT_STORE, RESEND_WEBHOOK_SECRET, SUPPORT_EMAIL_QUEUE, type ResendEventStore, type SupportEmailQueue } from "./support-email.constants.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

/** Fastify request with Nest's `rawBody: true` (main.ts) buffer. */
export interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
  body?: unknown;
}

const PG_PAYLOAD_TOO_LARGE = "54000";
const EMAIL_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const header = (h: RawRequest["headers"], name: string): string | undefined => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Resend inbound mail (`email.received`, ADR 0020). Authenticated ONLY by the Svix signature
 * (RESEND_WEBHOOK_SECRET) over the raw body; anything unverified is answered 401 and never
 * stored. Verified events land in inbound_events (dedupe_key resend:{email_id}); the worker
 * fetches the body and creates/updates the ticket. Never replies to the sender.
 */
@Public()
@Controller("webhooks/resend")
export class ResendWebhookController {
  private readonly logger = new Logger(ResendWebhookController.name);

  constructor(
    @Inject(RESEND_EVENT_STORE) private readonly store: ResendEventStore,
    @Optional() @Inject(SUPPORT_EMAIL_QUEUE) private readonly queue: SupportEmailQueue | null,
    @Optional() @Inject(RESEND_WEBHOOK_SECRET) private readonly secret: string | null,
    @Optional() @Inject("NOW_SECONDS") private readonly now: (() => number) | null = null,
  ) {}

  @Post()
  async receive(@Req() req: RawRequest, @Res() reply: Reply): Promise<void> {
    if (!this.secret) {
      this.logger.error("resend webhook received but RESEND_WEBHOOK_SECRET is not set");
      reply.code(401).send();
      return;
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      reply.code(400).send();
      return;
    }
    const verdict = verifySvixSignature(
      raw,
      { id: header(req.headers, "svix-id"), timestamp: header(req.headers, "svix-timestamp"), signature: header(req.headers, "svix-signature") },
      this.secret,
      this.now ? this.now() : undefined,
    );
    if (verdict !== "ok") {
      this.logger.warn(`resend webhook rejected (${verdict})`);
      reply.code(401).send();
      return;
    }
    let event: { type?: unknown; data?: { email_id?: unknown } };
    try {
      event = JSON.parse(raw.toString("utf8")) as typeof event;
    } catch {
      reply.code(400).send();
      return;
    }
    // Other event types (sent/delivered/bounced...) are acknowledged and ignored.
    if (event?.type !== "email.received") {
      reply.code(200).send();
      return;
    }
    const emailId = event.data?.email_id;
    if (typeof emailId !== "string" || !EMAIL_ID_RE.test(emailId)) {
      reply.code(400).send();
      return;
    }
    try {
      const stored = await this.store.ingest(`resend:${emailId}`, event);
      if (stored.inserted && this.queue) {
        try {
          await this.queue.add(
            "process-resend-email",
            { eventId: stored.eventId },
            { jobId: `resend-${stored.eventId}`, attempts: 8, backoff: { type: "exponential", delay: 5_000 }, removeOnComplete: { count: 1000 }, removeOnFail: { count: 5000 } },
          );
        } catch (err) {
          this.logger.warn(`support email enqueue failed (${err instanceof Error ? err.name : "unknown"}); the sweep will retry`);
        }
      }
      reply.code(200).send();
    } catch (err) {
      if (pgCode(err) === PG_PAYLOAD_TOO_LARGE) {
        reply.code(413).send();
        return;
      }
      // Never log the message: postgres embeds parameters (payload) in it.
      this.logger.error(`resend webhook ingestion failed (${err instanceof Error ? err.name : "unknown"})`);
      reply.code(503).send();
    }
  }
}
