import { Controller, HttpCode, Inject, Logger, Param, Post, Req, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import { UNAUTHORIZED_MIN_MS } from "../webhooks/webhooks.controller.js";
import { isWellFormedWebhookToken, tokenPrefix } from "../webhooks/webhooks.constants.js";
import { MercadoPagoWebhookService } from "./mercadopago-webhook.service.js";

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

// Authenticated by the opaque URL token (tenant) AND the `x-signature` HMAC; status confirmed by API fetch.
@Public()
@Controller("webhooks/mercadopago")
export class MercadoPagoWebhookController {
  private readonly logger = new Logger(MercadoPagoWebhookController.name);

  constructor(@Inject(MercadoPagoWebhookService) private readonly service: MercadoPagoWebhookService) {}

  @Post(":webhookToken")
  @HttpCode(200)
  async receive(@Param("webhookToken") token: string, @Req() req: RawRequest, @Res() reply: Reply): Promise<void> {
    const started = Date.now();
    const unauthorized = async (): Promise<void> => {
      const jitter = Math.floor(Math.random() * 20);
      await sleep(Math.max(0, UNAUTHORIZED_MIN_MS + jitter - (Date.now() - started)));
      reply.code(401).send();
    };
    if (!isWellFormedWebhookToken(token)) return await unauthorized();
    const raw = req.rawBody && Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.alloc(0);
    try {
      const out = await this.service.handle(token, raw, req.headers, queryOf(req.query));
      if (out.kind === "unknown-token") return await unauthorized();
      if (out.kind === "invalid-signature" || out.kind === "invalid-payload") {
        reply.code(400).send();
        return;
      }
      reply.code(200).send();
    } catch (err) {
      this.logger.error(`mercadopago webhook failed for token ${tokenPrefix(token)} (${err instanceof Error ? err.name : "unknown"})`);
      reply.code(503).send();
    }
  }
}
