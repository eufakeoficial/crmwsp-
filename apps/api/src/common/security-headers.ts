import helmet from "@fastify/helmet";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/**
 * Security headers for a JSON API (CN-006): no CSP (nothing is rendered), HSTS, nosniff,
 * X-Frame-Options DENY, no referrer. Registered as an onRequest-level plugin, so it does not touch
 * body parsing (raw-body webhook routes keep their exact bytes).
 */
export async function registerSecurityHeaders(app: NestFastifyApplication): Promise<void> {
  await app.register(helmet as never, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    hsts: { maxAge: 31_536_000, includeSubDomains: true },
    noSniff: true,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
  } as never);
}
