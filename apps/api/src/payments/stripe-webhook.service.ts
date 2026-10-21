import { Inject, Injectable, Logger } from "@nestjs/common";
import { EncryptionNotConfiguredError } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import type { DbHandle } from "@crmwsp/db";
import { InvalidSignatureError, PaymentProviderError, parseStripeWebhook, type VerifiedPaymentEvent, type WebhookHeaders } from "@crmwsp/payments";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { tokenPrefix } from "../webhooks/webhooks.constants.js";
import { applyStripeEvent, type PaymentEventOutcome, type PaymentLedger } from "./payment-ledger.js";
import { PAYMENT_LEDGER, PAYMENTS_CLOCK, STRIPE_WEBHOOK_RESOLVER, STRIPE_WEBHOOK_SECRET_PURPOSE } from "./payments.constants.js";

export interface ResolvedStripeWebhook {
  tenantId: string;
  webhookSecretEncrypted: Buffer;
}

/** Port over `resolve_payment_webhook` (SECURITY DEFINER, 0018). */
export interface StripeWebhookResolver {
  resolve(token: string): Promise<ResolvedStripeWebhook | null>;
}

export class PgStripeWebhookResolver implements StripeWebhookResolver {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async resolve(token: string): Promise<ResolvedStripeWebhook | null> {
    const rows = await this.sql<Array<{ tenant_id: string; webhook_secret_encrypted: Buffer }>>`
      select tenant_id, webhook_secret_encrypted from public.resolve_payment_webhook('stripe', ${token})`;
    const r = rows[0];
    return r ? { tenantId: r.tenant_id, webhookSecretEncrypted: r.webhook_secret_encrypted } : null;
  }
}

export type StripeWebhookOutcome =
  | { kind: "unknown-token" }
  | { kind: "invalid-signature" }
  | { kind: "invalid-payload" }
  | { kind: "processed"; outcomes: PaymentEventOutcome[] };

@Injectable()
export class StripeWebhookService {
  private readonly logger = new Logger(StripeWebhookService.name);

  constructor(
    @Inject(STRIPE_WEBHOOK_RESOLVER) private readonly resolver: StripeWebhookResolver,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(PAYMENTS_CLOCK) private readonly now: () => number,
  ) {}

  /**
   * `rawBody` MUST be the exact bytes Stripe sent (signature is over them). Throws on transient
   * failures (DB, crypto not configured) so the controller answers 5xx and Stripe retries.
   */
  async handle(token: string, rawBody: Uint8Array, headers: WebhookHeaders): Promise<StripeWebhookOutcome> {
    const conn = await this.resolver.resolve(token);
    if (!conn) {
      this.logger.warn(`stripe webhook with unknown token ${tokenPrefix(token)}`);
      return { kind: "unknown-token" };
    }
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const secret = this.cipher.decrypt(conn.webhookSecretEncrypted, {
      tenantId: conn.tenantId,
      purpose: STRIPE_WEBHOOK_SECRET_PURPOSE,
    });

    let events: VerifiedPaymentEvent[];
    try {
      events = parseStripeWebhook(rawBody, headers, secret, this.now());
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        // Unverified bytes are never stored or applied.
        this.logger.warn(`stripe webhook signature rejected for token ${tokenPrefix(token)}`);
        return { kind: "invalid-signature" };
      }
      if (err instanceof PaymentProviderError) {
        this.logger.warn(`stripe webhook payload rejected for token ${tokenPrefix(token)}`);
        return { kind: "invalid-payload" };
      }
      throw err;
    }

    // Signature verified: safe to keep the parsed event for audit.
    const payload: unknown = JSON.parse(new TextDecoder().decode(rawBody));
    const outcomes: PaymentEventOutcome[] = [];
    for (const ev of events) {
      const outcome = await applyStripeEvent(this.ledger, conn.tenantId, ev, payload);
      outcomes.push(outcome);
      if (outcome !== "applied" && outcome !== "duplicate" && outcome !== "ignored") {
        this.logger.warn(`stripe event ${ev.dedupeKey} for token ${tokenPrefix(token)} not applied: ${outcome}`);
      }
    }
    return { kind: "processed", outcomes };
  }
}
