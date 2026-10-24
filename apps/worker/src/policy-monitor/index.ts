import { createHash } from "node:crypto";
import { sql, type Database } from "@crmwsp/db";
import { POLICY_SOURCES, diffPolicyText, normalizePolicyText, type PolicySource } from "@crmwsp/domain";
import { Worker, type ConnectionOptions, type Job, type Queue } from "bullmq";
import { notifyPlatformAdmins, type AlertMailer } from "../platform-alerts.js";
import type { Logger } from "../processors.js";

/**
 * Daily Meta/WhatsApp policy monitor (ADR 0021, T3). Once a day, low frequency, identifiable
 * User-Agent, If-None-Match, timeout, small retry and size cap. Stores a snapshot when the
 * normalized text hash changes and creates a pending "policy change" for platform admins, who
 * review it in the backoffice. Nothing is ever applied automatically. No secrets are involved.
 */

export const POLICY_MONITOR_QUEUE_NAME = "policy-monitor";
export const POLICY_MONITOR_TICK_JOB = "policy-monitor-tick";
export const POLICY_MONITOR_SCHEDULER_ID = "policy-monitor-daily";
export const POLICY_MONITOR_EVERY_MS = 24 * 3600_000;
export const POLICY_FETCH_TIMEOUT_MS = 20_000;
export const POLICY_MAX_BYTES = 2 * 1024 * 1024;
/** Stored text cap (the DB check allows 600 000 chars). */
export const POLICY_MAX_CHARS = 500_000;
export const POLICY_USER_AGENT = "VendeMasWSP-PolicyMonitor/1.0 (+https://vendemaswsp.com; daily policy check)";

export type PolicyFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal; redirect: "follow" }) => Promise<Response>;

export interface PolicyMonitorDeps {
  db: Database;
  fetch?: PolicyFetch;
  mailer?: AlertMailer;
  logger?: Logger;
  sources?: readonly PolicySource[];
  /** Retries per source after the first attempt (default 2). */
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type SourceOutcome = "unchanged" | "not_modified" | "first_snapshot" | "changed" | "failed";

export interface PolicyMonitorResult {
  outcomes: Record<string, SourceOutcome>;
  changes: number;
}

export const policyTextHash = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** Reads the body up to maxBytes; larger bodies throw (never buffered whole). */
async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new Error("policy source too large");
  if (!res.body) return await res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("policy source too large");
    }
    chunks.push(value);
  }
  return new TextDecoder("utf-8").decode(Buffer.concat(chunks));
}

type Fetched = { kind: "not_modified" } | { kind: "ok"; text: string; contentType: string; etag: string | null };

async function fetchSource(deps: PolicyMonitorDeps, url: string, etag: string | null): Promise<Fetched> {
  const f = deps.fetch ?? (globalThis.fetch as unknown as PolicyFetch);
  const retries = deps.retries ?? 2;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const headers: Record<string, string> = { "user-agent": POLICY_USER_AGENT, accept: "text/markdown, text/plain, text/html;q=0.9" };
      if (etag) headers["if-none-match"] = etag;
      const res = await f(url, { headers, signal: AbortSignal.timeout(POLICY_FETCH_TIMEOUT_MS), redirect: "follow" });
      if (res.status === 304) return { kind: "not_modified" };
      // 4xx (except 429) will not improve with a retry today.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) throw Object.assign(new Error(`http ${res.status}`), { final: true });
      if (!res.ok) throw new Error(`http ${res.status}`);
      return { kind: "ok", text: await readCapped(res, POLICY_MAX_BYTES), contentType: res.headers.get("content-type") ?? "text/plain", etag: res.headers.get("etag") };
    } catch (err) {
      lastErr = err;
      if ((err as { final?: boolean }).final) break;
      if (attempt < retries) await sleep(2_000 * 2 ** attempt);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("policy fetch failed");
}

/** One pass over every source; a failing source never blocks the others. */
export async function runPolicyMonitor(deps: PolicyMonitorDeps): Promise<PolicyMonitorResult> {
  const result: PolicyMonitorResult = { outcomes: {}, changes: 0 };
  const changed: string[] = [];
  for (const src of deps.sources ?? POLICY_SOURCES) {
    try {
      const [last] = await deps.db.execute<{ content_hash: string; content: string; etag: string | null }>(
        sql`select content_hash, content, etag from public.policy_monitor_last(${src.key})`,
      );
      const got = await fetchSource(deps, src.url, last?.etag ?? null);
      if (got.kind === "not_modified") {
        result.outcomes[src.key] = "not_modified";
        continue;
      }
      const text = normalizePolicyText(got.text, got.contentType).slice(0, POLICY_MAX_CHARS);
      const hash = policyTextHash(text);
      if (last && last.content_hash === hash) {
        result.outcomes[src.key] = "unchanged";
        continue;
      }
      const diff = last ? diffPolicyText(last.content, text) : { added: [], removed: [], summary: "" };
      const [row] = await deps.db.execute<{ id: string | null }>(
        sql`select public.policy_monitor_record(${src.key}, ${src.url}, ${hash}, ${text}, ${got.etag}, ${diff.summary.slice(0, 40_000)}, ${diff.added.length}, ${diff.removed.length}) as id`,
      );
      if (row?.id) {
        result.outcomes[src.key] = "changed";
        result.changes++;
        changed.push(`${src.label} (${src.url}): +${diff.added.length} / -${diff.removed.length} líneas\n${diff.summary.slice(0, 2_000)}`);
      } else {
        result.outcomes[src.key] = last ? "unchanged" : "first_snapshot";
      }
    } catch (err) {
      result.outcomes[src.key] = "failed";
      deps.logger?.warn(`policy monitor: ${src.key} failed (${err instanceof Error ? err.message.slice(0, 80) : "unknown"})`);
    }
  }
  if (changed.length > 0) {
    await notifyPlatformAdmins(
      deps.db,
      deps.mailer,
      `[Vende+ WSP] Cambios en políticas de Meta/WhatsApp (${changed.length})`,
      `El monitor diario detectó cambios. Revísalos en el backoffice (Políticas de WhatsApp) y decide si hay que actualizar las reglas de rubros. Nada se aplica automáticamente.\n\n${changed.join("\n\n")}`,
      deps.logger,
    );
  }
  return result;
}

export interface PolicyMonitorWorkerOptions extends PolicyMonitorDeps {
  connection: ConnectionOptions;
}

export function createPolicyMonitorWorker(opts: PolicyMonitorWorkerOptions): Worker {
  const { connection, ...deps } = opts;
  return new Worker(
    POLICY_MONITOR_QUEUE_NAME,
    async (job: Job) => {
      if (job.name === POLICY_MONITOR_TICK_JOB) return runPolicyMonitor(deps);
      return undefined;
    },
    { connection, concurrency: 1 },
  );
}

export async function schedulePolicyMonitorTick(queue: Pick<Queue, "upsertJobScheduler">, everyMs = POLICY_MONITOR_EVERY_MS): Promise<void> {
  await queue.upsertJobScheduler(
    POLICY_MONITOR_SCHEDULER_ID,
    { every: everyMs },
    { name: POLICY_MONITOR_TICK_JOB, data: {}, opts: { attempts: 1, removeOnComplete: { count: 30 }, removeOnFail: { count: 30 } } },
  );
}
