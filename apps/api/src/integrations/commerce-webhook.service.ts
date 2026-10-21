import { Inject, Injectable, Logger } from "@nestjs/common";
import { EncryptionNotConfiguredError } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import type { DbHandle } from "@crmwsp/db";
import {
  CommercePayloadError,
  InvalidSignatureError,
  commerceProviders,
  connectorFor,
  type CommerceProvider,
  type NormalizedCommerceEvent,
  type WebhookHeaders,
} from "@crmwsp/integrations";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { tokenPrefix } from "../webhooks/webhooks.constants.js";
import { applyCommerceEvent, type CommerceEventOutcome, type CommerceLedger } from "./commerce-ledger.js";
import { COMMERCE_LEDGER, COMMERCE_WEBHOOK_RESOLVER, commerceWebhookSecretPurpose } from "./integrations.constants.js";

export interface ResolvedCommerceWebhook {
  tenantId: string;
  webhookSecretEncrypted: Buffer;
  shopCurrency: string | null;
}

/** Port over `resolve_commerce_webhook` (SECURITY DEFINER, 0022). */
export interface CommerceWebhookResolver {
  resolve(provider: CommerceProvider, token: string): Promise<ResolvedCommerceWebhook | null>;
}

export class PgCommerceWebhookResolver implements CommerceWebhookResolver {
  constructor(private readonly sql: DbHandle["sql"]) {}

  async resolve(provider: CommerceProvider, token: string): Promise<ResolvedCommerceWebhook | null> {
    const rows = await this.sql<Array<{ tenant_id: string; webhook_secret_encrypted: Buffer; shop_currency: string | null }>>`
      select tenant_id, webhook_secret_encrypted, shop_currency from public.resolve_commerce_webhook(${provider}, ${token})`;
    const r = rows[0];
    return r ? { tenantId: r.tenant_id, webhookSecretEncrypted: r.webhook_secret_encrypted, shopCurrency: r.shop_currency } : null;
  }
}

export function isCommerceProvider(p: unknown): p is CommerceProvider {
  return typeof p === "string" && (commerceProviders as readonly string[]).includes(p);
}

export type CommerceWebhookOutcome =
  | { kind: "unknown-token" }
  | { kind: "invalid-signature" }
  | { kind: "invalid-payload" }
  | { kind: "processed"; outcome: CommerceEventOutcome };

function auditPayload(raw: Uint8Array): unknown {
  const text = new TextDecoder().decode(raw);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    // Form-encoded (Gumroad): keep the fields, which are already verified to come from the seller.
    return Object.fromEntries(new URLSearchParams(text));
  }
}

@Injectable()
export class CommerceWebhookService {
  private readonly logger = new Logger(CommerceWebhookService.name);

  constructor(
    @Inject(COMMERCE_WEBHOOK_RESOLVER) private readonly resolver: CommerceWebhookResolver,
    @Inject(COMMERCE_LEDGER) private readonly ledger: CommerceLedger,
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
  ) {}

  /** Throws on transient failures so the controller answers 503 and the provider retries. */
  async handle(
    provider: CommerceProvider,
    token: string,
    rawBody: Uint8Array,
    headers: WebhookHeaders,
    query: Record<string, string | undefined>,
  ): Promise<CommerceWebhookOutcome> {
    const conn = await this.resolver.resolve(provider, token);
    if (!conn) {
      this.logger.warn(`${provider} webhook with unknown token ${tokenPrefix(token)}`);
      return { kind: "unknown-token" };
    }
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const secret = this.cipher.decrypt(conn.webhookSecretEncrypted, { tenantId: conn.tenantId, purpose: commerceWebhookSecretPurpose(provider) });

    let ev: NormalizedCommerceEvent;
    try {
      ev = connectorFor(provider).verifyWebhook(rawBody, headers, secret, { query, currency: conn.shopCurrency });
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        this.logger.warn(`${provider} webhook signature rejected for token ${tokenPrefix(token)}`);
        return { kind: "invalid-signature" };
      }
      if (err instanceof CommercePayloadError) {
        this.logger.warn(`${provider} webhook payload rejected for token ${tokenPrefix(token)}`);
        return { kind: "invalid-payload" };
      }
      throw err;
    }
    const { outcome } = await applyCommerceEvent(this.ledger, conn.tenantId, ev, auditPayload(rawBody), { shopCurrency: conn.shopCurrency });
    return { kind: "processed", outcome };
  }
}
