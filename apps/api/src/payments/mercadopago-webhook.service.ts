import { Inject, Injectable, Logger } from "@nestjs/common";
import { EncryptionNotConfiguredError } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { eq, paymentConnections, withTenant, type DbHandle } from "@crmwsp/db";
import type {
  MercadoPagoProvider} from "@crmwsp/payments";
import {
  InvalidSignatureError,
  PaymentProviderError,
  mercadoPagoEvent,
  parseMercadoPagoNotification,
  type MercadoPagoNotification,
  type WebhookHeaders,
} from "@crmwsp/payments";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { tokenPrefix } from "../webhooks/webhooks.constants.js";
import { applyPaymentEvent, type PaymentEventOutcome, type PaymentLedger } from "./payment-ledger.js";
import {
  MERCADOPAGO_ACCESS_TOKEN_PURPOSE,
  MERCADOPAGO_PROVIDER_FACTORY,
  MERCADOPAGO_WEBHOOK_RESOLVER,
  MERCADOPAGO_WEBHOOK_SECRET_PURPOSE,
  PAYMENT_LEDGER,
  PAYMENTS_CLOCK,
} from "./payments.constants.js";

export interface ResolvedMercadoPagoWebhook {
  tenantId: string;
  webhookSecretEncrypted: Buffer;
  /** Loaded under the tenant (RLS) only after the URL token resolved. */
  accessTokenEncrypted: Buffer;
}

export interface MercadoPagoWebhookResolver {
  resolve(token: string): Promise<ResolvedMercadoPagoWebhook | null>;
}

/** `resolve_payment_webhook` (SECURITY DEFINER, 0018) then the access-token ciphertext under RLS. */
export class PgMercadoPagoWebhookResolver implements MercadoPagoWebhookResolver {
  constructor(private readonly h: DbHandle) {}

  async resolve(token: string): Promise<ResolvedMercadoPagoWebhook | null> {
    const rows = await this.h.sql<Array<{ tenant_id: string; connection_id: string; webhook_secret_encrypted: Buffer }>>`
      select tenant_id, connection_id, webhook_secret_encrypted from public.resolve_payment_webhook('mercadopago', ${token})`;
    const r = rows[0];
    if (!r) return null;
    const [c] = await withTenant(this.h.db, r.tenant_id, (tx) =>
      tx.select({ key: paymentConnections.secretKeyEncrypted }).from(paymentConnections).where(eq(paymentConnections.id, r.connection_id)),
    );
    return c ? { tenantId: r.tenant_id, webhookSecretEncrypted: r.webhook_secret_encrypted, accessTokenEncrypted: c.key } : null;
  }
}

export type MercadoPagoProviderFactory = (accessToken: string) => Pick<MercadoPagoProvider, "getPaymentById" | "createPaymentLink">;

export type MercadoPagoWebhookOutcome =
  | { kind: "unknown-token" }
  | { kind: "invalid-signature" }
  | { kind: "invalid-payload" }
  | { kind: "processed"; outcome: PaymentEventOutcome | "ignored" };

@Injectable()
export class MercadoPagoWebhookService {
  private readonly logger = new Logger(MercadoPagoWebhookService.name);

  constructor(
    @Inject(MERCADOPAGO_WEBHOOK_RESOLVER) private readonly resolver: MercadoPagoWebhookResolver,
    @Inject(PAYMENT_LEDGER) private readonly ledger: PaymentLedger,
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(PAYMENTS_CLOCK) private readonly now: () => number,
    @Inject(MERCADOPAGO_PROVIDER_FACTORY) private readonly providerFactory: MercadoPagoProviderFactory,
  ) {}

  /**
   * Signature first, then the payment is FETCHED from the MP API: status and amount come only
   * from that response, never from the notification body. Throws on transient failures (5xx -> MP
   * retries); replays are deduped by (payment id, status) in payment_events.
   */
  async handle(token: string, rawBody: Uint8Array, headers: WebhookHeaders, query: Record<string, string | undefined>): Promise<MercadoPagoWebhookOutcome> {
    const conn = await this.resolver.resolve(token);
    if (!conn) {
      this.logger.warn(`mercadopago webhook with unknown token ${tokenPrefix(token)}`);
      return { kind: "unknown-token" };
    }
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const ctx = (purpose: string) => ({ tenantId: conn.tenantId, purpose });
    const secret = this.cipher.decrypt(conn.webhookSecretEncrypted, ctx(MERCADOPAGO_WEBHOOK_SECRET_PURPOSE));

    let n: MercadoPagoNotification;
    try {
      n = parseMercadoPagoNotification(rawBody, headers, query, secret, this.now());
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        this.logger.warn(`mercadopago webhook signature rejected for token ${tokenPrefix(token)}`);
        return { kind: "invalid-signature" };
      }
      if (err instanceof PaymentProviderError) return { kind: "invalid-payload" };
      throw err;
    }
    if (n.kind === "ignored") return { kind: "processed", outcome: "ignored" };

    const provider = this.providerFactory(this.cipher.decrypt(conn.accessTokenEncrypted, ctx(MERCADOPAGO_ACCESS_TOKEN_PURPOSE)));
    // Network call outside any DB transaction. A non-retryable API answer (e.g. 404 for a payment
    // of another account) is recorded nowhere and acknowledged; transient ones bubble up (503).
    let payment;
    try {
      payment = await provider.getPaymentById(n.paymentId);
    } catch (err) {
      if (err instanceof PaymentProviderError && !err.retryable) {
        this.logger.warn(`mercadopago payment fetch rejected for token ${tokenPrefix(token)} (${err.status ?? "?"})`);
        return { kind: "invalid-payload" };
      }
      throw err;
    }
    const event = mercadoPagoEvent(payment);
    // Audit payload: what the API confirmed (no buyer PII beyond what we normalized).
    const audit = { notification: { action: n.action, paymentId: n.paymentId }, payment: { id: payment.id, status: payment.status, amountMinor: payment.amountMinor, currency: payment.currency, externalReference: payment.externalReference } };
    const outcome = await applyPaymentEvent(this.ledger, conn.tenantId, event, audit, "mercadopago");
    if (outcome !== "applied" && outcome !== "duplicate" && outcome !== "ignored") {
      this.logger.warn(`mercadopago event ${event.dedupeKey} for token ${tokenPrefix(token)} not applied: ${outcome}`);
    }
    return { kind: "processed", outcome };
  }
}
