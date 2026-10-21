import { Controller, HttpCode, Inject, Logger, Param, Post, Req, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import { UNAUTHORIZED_MIN_MS } from "../webhooks/webhooks.controller.js";
import { isWellFormedWebhookToken, tokenPrefix } from "../webhooks/webhooks.constants.js";
import { CommerceWebhookService, isCommerceProvider } from "./commerce-webhook.service.js";

interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

interface RawRequest {
  headers: Record<string, string | string[] | undefined>;
  query?: unknown;
  rawBody?: Buffer;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function queryOf(q: unknown): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  if (q && typeof q === "object") {
    for (const [k, v] of Object.entries(q as Record<string, unknown>)) if (typeof v === "string") out[k] = v;
  }
  return out;
}

// Authenticated by the opaque URL token (tenant + provider) AND the provider signature / token.
@Public()
@Controller("webhooks/commerce")
export class CommerceWebhookController {
  private readonly logger = new Logger(CommerceWebhookController.name);

  constructor(@Inject(CommerceWebhookService) private readonly service: CommerceWebhookService) {}

  @Post(":provider/:webhookToken")
  @HttpCode(200)
  async receive(@Param("provider") provider: string, @Param("webhookToken") token: string, @Req() req: RawRequest, @Res() reply: Reply): Promise<void> {
    const started = Date.now();
    const unauthorized = async (): Promise<void> => {
      const jitter = Math.floor(Math.random() * 20);
      await sleep(Math.max(0, UNAUTHORIZED_MIN_MS + jitter - (Date.now() - started)));
      reply.code(401).send();
    };
    if (!isCommerceProvider(provider) || !isWellFormedWebhookToken(token)) return await unauthorized();
    const raw = req.rawBody;
    if (!raw || !Buffer.isBuffer(raw)) {
      this.logger.error(`${provider} webhook received without raw body`);
      reply.code(400).send();
      return;
    }
    try {
      const out = await this.service.handle(provider, token, raw, req.headers, queryOf(req.query));
      if (out.kind === "unknown-token") return await unauthorized();
      if (out.kind === "invalid-signature" || out.kind === "invalid-payload") {
        reply.code(400).send();
        return;
      }
      reply.code(200).send();
    } catch (err) {
      this.logger.error(`${provider} webhook failed for token ${tokenPrefix(token)} (${err instanceof Error ? err.name : "unknown"})`);
      // 5xx: the provider retries; nothing was committed (single transaction) and replays are deduped.
      reply.code(503).send();
    }
  }
}
