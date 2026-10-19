import type { IncomingMessage, ServerResponse } from "node:http";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import type { WebhookRateLimiter } from "./rate-limiter.js";
import { WEBHOOK_BODY_LIMIT, WEBHOOK_RATE_LIMITER } from "./webhooks.constants.js";

/**
 * Runs before body parsing (Fastify onRequest via middie): rejects declared bodies over
 * 1 MiB with 413 and applies the per-token / per-IP rate limit (429). Chunked bodies
 * without content-length are capped by the route bodyLimit pinned in WebhooksCoreModule.
 */
@Injectable()
export class WebhookGuardMiddleware implements NestMiddleware<IncomingMessage, ServerResponse> {
  constructor(@Inject(WEBHOOK_RATE_LIMITER) private readonly limiter: WebhookRateLimiter) {}

  use(req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void): void {
    const length = Number(req.headers["content-length"] ?? 0);
    if (Number.isFinite(length) && length > WEBHOOK_BODY_LIMIT) {
      res.statusCode = 413;
      res.setHeader("connection", "close");
      res.end();
      return;
    }
    const path = (req.url ?? "").split("?")[0] ?? "";
    const token = path.split("/").filter(Boolean).pop() ?? "";
    // TODO: honour X-Forwarded-For only behind a trusted proxy (Fastify trustProxy).
    const ip = req.socket?.remoteAddress ?? "unknown";
    if (!this.limiter.hit(token, ip)) {
      res.statusCode = 429;
      res.setHeader("retry-after", "60");
      res.end();
      return;
    }
    next();
  }
}
