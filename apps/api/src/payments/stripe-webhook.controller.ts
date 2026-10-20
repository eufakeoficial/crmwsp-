import { Controller, HttpCode, Inject, Logger, Param, Post, Req, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import { UNAUTHORIZED_MIN_MS } from "../webhooks/webhooks.controller.js";
import { isWellFormedWebhookToken, tokenPrefix } from "../webhooks/webhooks.constants.js";
import { StripeWebhookService } from "./stripe-webhook.service.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

/** Fastify request with Nest's `rawBody: true` (main.ts) buffer. */
interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody?: Buffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Authenticated by the opaque URL token (tenant) AND the Stripe signature (authenticity).
@Public()
@Controller("webhooks/stripe")
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(@Inject(StripeWebhookService) private readonly service: StripeWebhookService) {}

  @Post(":webhookToken")
  @HttpCode(200)
  async receive(@Param("webhookToken") token: string, @Req() req: RawRequest, @Res() reply: Reply): Promise<void> {
    const started = Date.now();
    const unauthorized = async (): Promise<void> => {
      const jitter = Math.floor(Math.random() * 20);
      await sleep(Math.max(0, UNAUTHORIZED_MIN_MS + jitter - (Date.now() - started)));
      reply.code(401).send();
    };
    if (!isWellFormedWebhookToken(token)) {
      await unauthorized();
      return;
    }
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      // Without the exact bytes the signature cannot be verified; never fall back to re-serialized JSON.
      this.logger.error("stripe webhook received without raw body (rawBody not enabled?)");
      reply.code(400).send();
      return;
    }
    try {
      const out = await this.service.handle(token, raw, req.headers);
      if (out.kind === "unknown-token") return await unauthorized();
      if (out.kind === "invalid-signature" || out.kind === "invalid-payload") {
        reply.code(400).send();
        return;
      }
      // Processed, including recorded-and-ignored events: 200 so Stripe stops retrying.
      reply.code(200).send();
    } catch (err) {
      this.logger.error(`stripe webhook failed for token ${tokenPrefix(token)} (${err instanceof Error ? err.name : "unknown"})`);
      // 5xx: Stripe retries; nothing was committed (single transaction) and replays are deduped.
      reply.code(503).send();
    }
  }
}
