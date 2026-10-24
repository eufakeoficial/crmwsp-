import { createHash } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { BSP_HEADER, type InboundWebhookResult, type WhatsAppProvider } from "@crmwsp/whatsapp";
import type { Queue } from "bullmq";
import type { BspProvider, InboundEventStore } from "./inbound-event-store.js";
import {
  INBOUND_EVENT_STORE,
  INBOUND_QUEUE,
  INGEST_MESSAGE_JOB,
  INGEST_STATUS_JOB,
  WHATSAPP_PROVIDER,
  tokenPrefix,
  type InboundJobData,
} from "./webhooks.constants.js";

export type WebhookOutcome = "accepted" | "unknown-token";

/** Job options: 5 attempts with exponential backoff; jobId = eventId dedupes in BullMQ too. */
export const INBOUND_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
} as const;

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(INBOUND_EVENT_STORE) private readonly store: InboundEventStore,
    @Inject(INBOUND_QUEUE) private readonly queue: Queue,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  handleGupshup(token: string, body: unknown): Promise<WebhookOutcome> {
    return this.handle("gupshup", token, body);
  }

  /** Shared ingestion: dedupe key = message/status id; tenant is resolved from the per-connection URL token. */
  async handle(bsp: BspProvider, token: string, body: unknown): Promise<WebhookOutcome> {
    const results = this.provider.parseWebhook(body, { [BSP_HEADER]: bsp });
    const actionable = results.filter(
      (r): r is Exclude<InboundWebhookResult, { kind: "ignored" }> => r.kind !== "ignored",
    );

    if (actionable.length === 0) {
      // Unknown/ignored payloads (user-events, unsupported types, empty parse) are still stored
      // once for audit, keyed by the body hash. This also validates the token, so the response
      // for an unknown token is always the same 401.
      const hash = createHash("sha256")
        .update(JSON.stringify(body ?? null))
        .digest("hex");
      const res = await this.store.ingest(token, `ignored:${hash}`, body ?? null, false, bsp);
      // TODO: audit rows keep processed_at = NULL; a worker sweeper should close them.
      if (!res) return this.unknownToken(bsp, token);
      return "accepted";
    }

    for (const result of actionable) {
      // Neither Gupshup nor 360dialog signs callbacks; authenticity comes from the URL token, so signature_valid=false.
      const res = await this.store.ingest(token, result.dedupeKey, body, false, bsp);
      if (!res) return this.unknownToken(bsp, token);
      if (!res.eventId) continue;
      const data: InboundJobData = { eventId: res.eventId, tenantId: res.tenantId };
      // Enqueue also when the event already existed (inserted=false): if a previous enqueue failed
      // after the insert, the BSP retry recovers it; jobId=eventId keeps BullMQ from duplicating.
      await this.queue.add(result.kind === "message" ? INGEST_MESSAGE_JOB : INGEST_STATUS_JOB, data, {
        ...INBOUND_JOB_OPTIONS,
        jobId: res.eventId,
      });
    }
    return "accepted";
  }

  private unknownToken(bsp: BspProvider, token: string): WebhookOutcome {
    this.logger.warn(`${bsp} webhook with unknown token ${tokenPrefix(token)}`);
    return "unknown-token";
  }
}
