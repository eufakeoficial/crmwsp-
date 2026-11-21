import { Inject, Injectable } from "@nestjs/common";
import { wooPublicConnectRequestSchema, type UpsertCommerceConnectionRequest, type WooPublicConnectResponse } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { StoreRateLimiter, type RateLimitOptions } from "../auth/rate-limiter.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { defaultRateLimitStore, type CounterStore } from "../common/rate-limit-store.js";
import { parseOrThrow } from "../common/zod.js";
import { upsertCommerceConnection } from "./commerce-connection.upsert.js";
import { hashConnectCode } from "./connect-code.js";
import { CONNECT_CODE_REPOSITORY, type ConnectCodeRepository } from "./connect-code.repository.js";
import { commerceWebhookUrlFor } from "./integrations.constants.js";
import { resolveStoreCredentials } from "./store-credentials.js";

/** Per IP on the public exchange: 10 attempts / 15 min (a code has 50 bits; this stops online guessing). */
export const WOO_CONNECT_RATE_LIMIT: RateLimitOptions = { limit: 10, windowMs: 15 * 60 * 1000 };
export const WOO_CONNECT_COUNTER_STORE = Symbol("WOO_CONNECT_COUNTER_STORE");

export type WooConnectOutcome = { kind: "connected"; result: WooPublicConnectResponse } | { kind: "invalid-code" };

/**
 * Public WooCommerce exchange: a single-use connect code (issued by an owner/admin) + the store
 * credentials become the tenant's woocommerce connection. Never logs the code, keys or secrets.
 */
@Injectable()
export class WooConnectService {
  private readonly limiter: StoreRateLimiter;

  constructor(
    @Inject(CONNECT_CODE_REPOSITORY) private readonly codes: ConnectCodeRepository,
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(WOO_CONNECT_COUNTER_STORE) store: CounterStore,
  ) {
    this.limiter = new StoreRateLimiter(WOO_CONNECT_RATE_LIMIT, store, "woo-connect");
  }

  /** Throws RateLimitedError (429) and ValidationError (400); bad/expired/used code → invalid-code. */
  async connect(body: unknown, ip: string): Promise<WooConnectOutcome> {
    await this.limiter.consume(`ip:${ip}`);
    const req = parseOrThrow(wooPublicConnectRequestSchema, body);
    const input: UpsertCommerceConnectionRequest = {
      webhookSecret: req.webhookSecret,
      shopDomain: req.shopUrl,
      consumerKey: req.consumerKey,
      consumerSecret: req.consumerSecret,
    };
    // Validate the store credentials before burning the code.
    resolveStoreCredentials("woocommerce", input);
    const result = await this.codes.consumeInTenant(hashConnectCode(req.code), async (code, tx) => {
      const row = await upsertCommerceConnection(tx, this.cipher, {
        tenantId: code.tenantId,
        userId: code.userId,
        provider: "woocommerce",
        input,
        ip,
        auditExtra: { via: "connect_code" },
      });
      return { webhookUrl: commerceWebhookUrlFor("woocommerce", row.webhookToken), tenantName: code.tenantName };
    });
    return result ? { kind: "connected", result } : { kind: "invalid-code" };
  }
}

export const wooConnectCounterStoreProvider = { provide: WOO_CONNECT_COUNTER_STORE, useFactory: defaultRateLimitStore };
