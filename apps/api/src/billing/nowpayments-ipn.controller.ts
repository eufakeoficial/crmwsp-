import { Body, Controller, Headers, Inject, Logger, Optional, Post, Res } from "@nestjs/common";
import { nowPaymentsIpnSchema } from "@crmwsp/contracts";
import { InvalidSignatureError, NOWPAYMENTS_SIGNATURE_HEADER, verifyNowPaymentsSignature } from "@crmwsp/payments";
import { Public } from "../auth/decorators.js";
import { NOWPAYMENTS_IPN_SECRET } from "./subscription.constants.js";
import { SubscriptionService } from "./subscription.service.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

const PG_PAYLOAD_TOO_LARGE = "54000";

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * NOWPayments IPN for SaaS subscription charges (ADR 0013). Authenticated ONLY by the
 * HMAC-SHA512 `x-nowpayments-sig` (NOWPAYMENTS_IPN_SECRET); anything unverified is answered 401
 * and never stored. Verified events go to inbound_events first; the worker settles them.
 */
@Public()
@Controller("webhooks/nowpayments")
export class NowPaymentsIpnController {
  private readonly logger = new Logger(NowPaymentsIpnController.name);

  constructor(
    @Inject(SubscriptionService) private readonly subscriptions: SubscriptionService,
    @Optional() @Inject(NOWPAYMENTS_IPN_SECRET) private readonly secret: string | null,
  ) {}

  @Post()
  async receive(
    @Body() body: unknown,
    @Headers(NOWPAYMENTS_SIGNATURE_HEADER) signature: string | undefined,
    @Res() reply: Reply,
  ): Promise<void> {
    if (!this.secret) {
      this.logger.error("nowpayments IPN received but NOWPAYMENTS_IPN_SECRET is not set");
      reply.code(401).send();
      return;
    }
    try {
      verifyNowPaymentsSignature(body, signature, this.secret);
    } catch (err) {
      if (err instanceof InvalidSignatureError) {
        this.logger.warn("nowpayments IPN signature rejected");
        reply.code(401).send();
        return;
      }
      throw err;
    }
    const parsed = nowPaymentsIpnSchema.safeParse(body);
    if (!parsed.success) {
      reply.code(400).send();
      return;
    }
    const ipn = parsed.data;
    try {
      const known = await this.subscriptions.ingestIpn(String(ipn.payment_id), ipn.payment_status, ipn.order_id ?? null, body);
      // Unknown order ids are acknowledged (no retry storm) and dropped.
      if (!known) this.logger.warn("nowpayments IPN for an unknown order id dropped");
      reply.code(200).send();
    } catch (err) {
      if (pgCode(err) === PG_PAYLOAD_TOO_LARGE) {
        reply.code(413).send();
        return;
      }
      // Never log the error message: drizzle/postgres embed parameters (payload) in it.
      this.logger.error(`nowpayments IPN ingestion failed (${err instanceof Error ? err.name : "unknown"})`);
      reply.code(503).send();
    }
  }
}
