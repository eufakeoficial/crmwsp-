import { Body, Controller, Get, HttpCode, Inject, Logger, Param, Post, Res } from "@nestjs/common";
import { Public } from "../auth/decorators.js";
import type { BspProvider } from "./inbound-event-store.js";
import { WebhooksService } from "./webhooks.service.js";
import { isWellFormedWebhookToken, tokenPrefix } from "./webhooks.constants.js";

/** Minimal structural view of FastifyReply (avoids a direct fastify dependency). */
interface Reply {
  code(statusCode: number): Reply;
  send(payload?: unknown): unknown;
}

const PG_PAYLOAD_TOO_LARGE = "54000";

/**
 * Every 401 (malformed or unknown token) is answered no earlier than this after the request
 * started, so the DB lookup an unknown-but-well-formed token costs is not observable.
 */
export const UNAUTHORIZED_MIN_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Common receive flow of every BSP callback: well-formed token check, ingestion, uniform 401 for
 * malformed/unknown tokens (time floor), 413 for oversized payloads, 503 so the BSP retries.
 */
async function receiveBspWebhook(
  bsp: BspProvider,
  service: WebhooksService,
  logger: Logger,
  token: string,
  body: unknown,
  reply: Reply,
): Promise<void> {
  const started = Date.now();
  const unauthorized = async (): Promise<void> => {
    // Same status, empty body and time floor for malformed and unknown tokens.
    const jitter = Math.floor(Math.random() * 20);
    await sleep(Math.max(0, UNAUTHORIZED_MIN_MS + jitter - (Date.now() - started)));
    reply.code(401).send();
  };
  if (!isWellFormedWebhookToken(token)) {
    await unauthorized();
    return;
  }
  try {
    const outcome = await service.handle(bsp, token, body);
    if (outcome === "unknown-token") {
      await unauthorized();
      return;
    }
    reply.code(200).send();
  } catch (err) {
    if (pgCode(err) === PG_PAYLOAD_TOO_LARGE) {
      reply.code(413).send();
      return;
    }
    // Never log the error message itself: drizzle embeds query params (payload) in it.
    logger.error(
      `${bsp} webhook failed for token ${tokenPrefix(token)} (${err instanceof Error ? err.name : "unknown"}${
        pgCode(err) ? ` pg=${pgCode(err)}` : ""
      })`,
    );
    // 5xx so the BSP retries; ingestion is idempotent.
    reply.code(503).send();
  }
}

// Authenticated by the opaque URL token, not by a user session.
@Public()
@Controller("webhooks/gupshup")
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(@Inject(WebhooksService) private readonly service: WebhooksService) {}

  /** Some BSP dashboards probe the callback URL with GET; always 200, no DB access. */
  @Get(":webhookToken")
  @HttpCode(200)
  verify(): string {
    return "";
  }

  @Post(":webhookToken")
  async receive(@Param("webhookToken") token: string, @Body() body: unknown, @Res() reply: Reply): Promise<void> {
    await receiveBspWebhook("gupshup", this.service, this.logger, token, body, reply);
  }
}

/** 360dialog forwards Meta's Cloud API webhook body to `/webhooks/360dialog/:webhookToken`. */
@Public()
@Controller("webhooks/360dialog")
export class Dialog360WebhooksController {
  private readonly logger = new Logger(Dialog360WebhooksController.name);

  constructor(@Inject(WebhooksService) private readonly service: WebhooksService) {}

  @Get(":webhookToken")
  @HttpCode(200)
  verify(): string {
    return "";
  }

  @Post(":webhookToken")
  async receive(@Param("webhookToken") token: string, @Body() body: unknown, @Res() reply: Reply): Promise<void> {
    await receiveBspWebhook("360dialog", this.service, this.logger, token, body, reply);
  }
}
