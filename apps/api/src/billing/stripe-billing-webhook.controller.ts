import { Controller, Headers, Inject, Logger, Optional, Post, Req, Res } from "@nestjs/common";
import { InvalidSignatureError, STRIPE_SIGNATURE_HEADER, verifyStripeSignature } from "@crmwsp/payments";
import { Public } from "../auth/decorators.js";
import { STRIPE_BILLING_WEBHOOK_SECRET } from "./card-billing.constants.js";
import { CardBillingService } from "./card-billing.service.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

/** Fastify request with Nest's `rawBody: true` (main.ts): the signature covers the exact bytes. */
interface RawRequest {
  rawBody?: Buffer;
}

const PG_PAYLOAD_TOO_LARGE = "54000";

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Stripe Billing webhook for SaaS card subscriptions (ADR 0022). Authenticated ONLY by the
 * `Stripe-Signature` HMAC (STRIPE_WEBHOOK_SECRET) over the raw body; anything unverified is
 * answered 401 and never stored. Verified events go to inbound_events first (dedupe by Stripe
 * event id); the worker settles them. Tenants' own Stripe payments use `webhooks/stripe/:token`.
 */
@Public()
@Controller("webhooks/stripe-billing")
export class StripeBillingWebhookController {
  private readonly logger = new Logger(StripeBillingWebhookController.name);

  constructor(
    @Inject(CardBillingService) private readonly cards: CardBillingService,
    @Optional() @Inject(STRIPE_BILLING_WEBHOOK_SECRET) private readonly secret: string | null,
  ) {}

  @Post()
  async receive(
    @Req() req: RawRequest,
    @Headers(STRIPE_SIGNATURE_HEADER) signature: string | undefined,
    @Res() reply: Reply,
  ): Promise<void> {
    if (!this.secret) {
      this.logger.error("stripe billing webhook received but STRIPE_WEBHOOK_SECRET is not set");
      reply.code(401).send();
      return;
    }
    const raw = req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);
    try {
      verifyStripeSignature({ rawBody: raw, header: signature, secret: this.secret, nowMs: Date.now() });
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        this.logger.warn("stripe billing webhook signature rejected");
        reply.code(401).send();
        return;
      }
      throw err;
    }
    let body: unknown;
    try {
      body = JSON.parse(raw.toString("utf8"));
    } catch {
      reply.code(400).send();
      return;
    }
    try {
      const known = await this.cards.ingestEvent(body);
      // Unknown customers and event types we do not act on are acknowledged (no retry storm).
      if (!known) this.logger.debug("stripe billing event ignored");
      reply.code(200).send();
    } catch (err) {
      if (pgCode(err) === PG_PAYLOAD_TOO_LARGE) {
        reply.code(413).send();
        return;
      }
      // Never log the error message: drizzle/postgres embed parameters (payload) in it.
      this.logger.error(`stripe billing webhook ingestion failed (${err instanceof Error ? err.name : "unknown"})`);
      reply.code(503).send();
    }
  }
}
