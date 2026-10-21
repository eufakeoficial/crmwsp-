import type { IncomingMessage, ServerResponse } from "node:http";
import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";
import { commerceConnectors } from "@crmwsp/integrations";
import { clientIp } from "../common/client-ip.js";
import { WEAK_AUTH_MAX_PER_TOKEN, type WebhookRateLimiter } from "./rate-limiter.js";
import { WEBHOOK_BODY_LIMIT, WEBHOOK_RATE_LIMITER } from "./webhooks.constants.js";

const WEAK_AUTH_PROVIDERS = new Set(
  Object.values(commerceConnectors)
    .filter((c) => c.weakAuth)
    .map((c) => c.provider as string),
);

/** `/webhooks/commerce/<provider>/<token>` with a weakAuth provider -> tighter per-connection cap. */
export function perTokenCapFor(path: string): number | undefined {
  const parts = path.split("/").filter(Boolean);
  const i = parts.indexOf("commerce");
  if (i < 0 || parts[i - 1] !== "webhooks") return undefined;
  const provider = parts[i + 1];
  return provider && WEAK_AUTH_PROVIDERS.has(provider) ? WEAK_AUTH_MAX_PER_TOKEN : undefined;
}

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
    // Real client IP: trusted proxy hops or the HMAC-signed forward from the web app.
    const ip = clientIp(req);
    this.limiter.hit(token, ip, perTokenCapFor(path)).then(
      (allowed) => {
        if (allowed) return next();
        res.statusCode = 429;
        res.setHeader("retry-after", "60");
        res.end();
      },
      (err: unknown) => next(err),
    );
  }
}
