import { createHmac } from "node:crypto";
import type { CipherBox } from "@crmwsp/crypto";
import { webhookDeliveries, webhookEndpoints, withTenant, type Database, type Transaction } from "@crmwsp/db";
import {
  WEBHOOK_SECRET_PURPOSE,
  decideDeliveryOutcome,
  formatSignatureHeader,
  shouldAutoDisable,
  webhookSignedContent,
} from "@crmwsp/domain";
import { UnrecoverableError, Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import type { Logger } from "../processors.js";
import type { WebhookSender } from "./http.js";

export * from "./http.js";

export const WEBHOOK_QUEUE_NAME = "outbound-webhooks";
export const WEBHOOK_TICK_JOB = "webhook-tick";
export const WEBHOOK_SCHEDULER_ID = "webhook-tick-every-5s";
export const WEBHOOK_TICK_EVERY_MS = 5_000;
/** A claimed delivery is invisible to other ticks for this long (crash safety). */
export const WEBHOOK_CLAIM_LEASE_MS = 60_000;
const BATCH = 25;

export interface ClaimedDelivery {
  id: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
  url: string;
  secretEncrypted: Buffer;
}

export interface WebhookTickDeps {
  db: Database;
  cipher: CipherBox;
  send: WebhookSender;
  logger?: Logger;
  now?: () => Date;
}

export interface WebhookTickResult {
  tenants: number;
  attempted: number;
  delivered: number;
  failedTenants: number;
}

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

export function signWebhook(secret: string, timestampS: number, body: string): string {
  return formatSignatureHeader(timestampS, createHmac("sha256", secret).update(webhookSignedContent(timestampS, body)).digest("hex"));
}

/** Claims due deliveries of active endpoints (lease), and fails those whose endpoint is disabled. */
export async function claimDue(tx: Transaction, now: Date, limit = BATCH): Promise<ClaimedDelivery[]> {
  const rows = await tx
    .select({
      id: webhookDeliveries.id,
      endpointId: webhookDeliveries.endpointId,
      eventId: webhookDeliveries.eventId,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
      attempts: webhookDeliveries.attempts,
      url: webhookEndpoints.url,
      secretEncrypted: webhookEndpoints.secretEncrypted,
      endpointStatus: webhookEndpoints.status,
    })
    .from(webhookDeliveries)
    .innerJoin(webhookEndpoints, eq(webhookEndpoints.id, webhookDeliveries.endpointId))
    .where(and(eq(webhookDeliveries.status, "pending"), lte(webhookDeliveries.nextAttemptAt, now)))
    .orderBy(webhookDeliveries.nextAttemptAt)
    .limit(limit)
    .for("update", { of: webhookDeliveries, skipLocked: true });
  const disabled = rows.filter((r) => r.endpointStatus !== "active").map((r) => r.id);
  if (disabled.length) {
    await tx
      .update(webhookDeliveries)
      .set({ status: "failed", lastError: "endpoint_disabled", nextAttemptAt: null })
      .where(inArray(webhookDeliveries.id, disabled));
  }
  const live = rows.filter((r) => r.endpointStatus === "active");
  if (live.length) {
    await tx
      .update(webhookDeliveries)
      .set({ nextAttemptAt: new Date(now.getTime() + WEBHOOK_CLAIM_LEASE_MS) })
      .where(inArray(webhookDeliveries.id, live.map((r) => r.id)));
  }
  return live.map(({ endpointStatus: _s, ...r }) => r);
}

/** Records one attempt and updates the endpoint's consecutive-failure counter / auto-disable. */
export async function recordAttempt(
  tx: Transaction,
  d: ClaimedDelivery,
  res: { statusCode: number | null; error: string | null },
  now: Date,
): Promise<{ delivered: boolean; endpointDisabled: boolean }> {
  const attempt = d.attempts + 1;
  const outcome = decideDeliveryOutcome(attempt, res.statusCode, now);
  const lastError = outcome.kind === "delivered" ? null : (res.error ?? (res.statusCode !== null ? `http_${res.statusCode}` : "error"));
  await tx
    .update(webhookDeliveries)
    .set({
      attempts: attempt,
      status: outcome.kind === "delivered" ? "delivered" : outcome.kind === "failed" ? "failed" : "pending",
      lastStatusCode: res.statusCode,
      lastError,
      nextAttemptAt: outcome.kind === "retry" ? outcome.nextAttemptAt : null,
      deliveredAt: outcome.kind === "delivered" ? now : null,
    })
    .where(eq(webhookDeliveries.id, d.id));
  if (outcome.kind === "delivered") {
    await tx.update(webhookEndpoints).set({ consecutiveFailures: 0 }).where(eq(webhookEndpoints.id, d.endpointId));
    return { delivered: true, endpointDisabled: false };
  }
  const [ep] = await tx
    .update(webhookEndpoints)
    .set({ consecutiveFailures: sql`${webhookEndpoints.consecutiveFailures} + 1` })
    .where(eq(webhookEndpoints.id, d.endpointId))
    .returning({ failures: webhookEndpoints.consecutiveFailures, status: webhookEndpoints.status });
  if (ep && ep.status === "active" && shouldAutoDisable(ep.failures)) {
    await tx
      .update(webhookEndpoints)
      .set({ status: "disabled", disabledReason: "too_many_failures", updatedAt: now })
      .where(eq(webhookEndpoints.id, d.endpointId));
    return { delivered: false, endpointDisabled: true };
  }
  return { delivered: false, endpointDisabled: false };
}

/**
 * One pass: per tenant with due deliveries, claim (own tx), POST outside any transaction, then
 * record each attempt (own tx). The signing secret is decrypted in memory only; never logged.
 */
export async function runWebhookTick(deps: WebhookTickDeps): Promise<WebhookTickResult> {
  const logger = deps.logger ?? silent;
  const rows = await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from webhook_delivery_tenant_ids()`);
  const res: WebhookTickResult = { tenants: rows.length, attempted: 0, delivered: 0, failedTenants: 0 };
  for (const { tenant_id: tenantId } of rows) {
    try {
      const claimed = await withTenant(deps.db, tenantId, (tx) => claimDue(tx, deps.now?.() ?? new Date()));
      for (const d of claimed) {
        let out: { statusCode: number | null; error: string | null };
        try {
          const secret = deps.cipher.decrypt(d.secretEncrypted, { tenantId, purpose: WEBHOOK_SECRET_PURPOSE });
          const body = JSON.stringify(d.payload);
          const ts = Math.floor((deps.now?.() ?? new Date()).getTime() / 1000);
          out = await deps.send({
            url: d.url,
            body,
            headers: {
              "user-agent": "CRMWSP-Webhooks/1",
              "x-crmwsp-event": d.eventType,
              "x-crmwsp-event-id": d.eventId,
              "x-crmwsp-delivery": d.id,
              "x-crmwsp-signature": signWebhook(secret, ts, body),
            },
          });
        } catch (err) {
          out = { statusCode: null, error: err instanceof Error ? err.name.slice(0, 60) : "error" };
        }
        const r = await withTenant(deps.db, tenantId, (tx) => recordAttempt(tx, d, out, deps.now?.() ?? new Date()));
        res.attempted++;
        if (r.delivered) res.delivered++;
        if (r.endpointDisabled) logger.warn(`webhook endpoint ${d.endpointId} auto-disabled after consecutive failures`);
      }
    } catch (err) {
      res.failedTenants++;
      logger.warn(`webhook tick failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

export interface WebhookWorkerOptions extends WebhookTickDeps {
  connection: ConnectionOptions;
  queueName?: string;
}

export function createWebhookWorker(opts: WebhookWorkerOptions): Worker {
  const { connection, queueName = WEBHOOK_QUEUE_NAME, ...deps } = opts;
  return new Worker(
    queueName,
    async (job: Job) => {
      if (job.name !== WEBHOOK_TICK_JOB) throw new UnrecoverableError("unknown job name");
      return runWebhookTick(deps);
    },
    { connection, concurrency: 1 },
  );
}

export async function scheduleWebhookTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = WEBHOOK_TICK_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    WEBHOOK_SCHEDULER_ID,
    { every: everyMs },
    { name: WEBHOOK_TICK_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 500 } } },
  );
}
