import { META_ADS_TOKEN_PURPOSE } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { adSpendDaily, metaAdsConnections, withTenant, type Database, type Transaction } from "@crmwsp/db";
import { eq, sql } from "drizzle-orm";
import type { Logger } from "../processors.js";
import { MetaAdsError, fetchInsights, type InsightRow, type MetaGetFetch } from "./client.js";

export const META_ADS_UPSERT_BATCH = 200;

/** Persistence port of one tenant (Postgres adapter below; in-memory fake in tests). */
export interface MetaAdsStore {
  loadConnection(): Promise<{ adAccountId: string; currency: string | null; accessTokenEncrypted: Buffer } | null>;
  upsertDaily(adAccountId: string, rows: InsightRow[], now: Date): Promise<void>;
  recordResult(result: { ok: true; currency: string | null } | { ok: false; error: string }, now: Date): Promise<void>;
}

export interface MetaAdsSyncDeps {
  db: Database;
  cipher: CipherBox;
  fetch: MetaGetFetch;
  logger?: Logger;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  /** Test seams. */
  listTenants?: () => Promise<string[]>;
  inTenant?: <T>(tenantId: string, fn: (store: MetaAdsStore) => Promise<T>) => Promise<T>;
}

export type MetaAdsSyncResult = { status: "skipped" } | { status: "ok"; rows: number } | { status: "error"; error: string };

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

const storeRunner = (deps: MetaAdsSyncDeps) =>
  deps.inTenant ?? (<T>(tenantId: string, fn: (s: MetaAdsStore) => Promise<T>) => withTenant(deps.db, tenantId, (tx) => fn(createPgMetaAdsStore(tx, tenantId))));

/**
 * Syncs one tenant: decrypt the token, fetch the Insights (outside any transaction), upsert the
 * daily rows and record the outcome. Errors are stored sanitized (status + Meta code only).
 */
export async function syncMetaAdsTenant(deps: MetaAdsSyncDeps, tenantId: string): Promise<MetaAdsSyncResult> {
  const inTenant = storeRunner(deps);
  const now = () => deps.now?.() ?? new Date();
  const conn = await inTenant(tenantId, (s) => s.loadConnection());
  if (!conn) return { status: "skipped" };
  let rows: InsightRow[];
  try {
    const token = deps.cipher.decrypt(conn.accessTokenEncrypted, { tenantId, purpose: META_ADS_TOKEN_PURPOSE });
    rows = await fetchInsights({ fetch: deps.fetch, ...(deps.sleep ? { sleep: deps.sleep } : {}) }, conn.adAccountId, token, conn.currency);
  } catch (err) {
    const error = err instanceof MetaAdsError ? err.code : `internal:${err instanceof Error ? err.name : "unknown"}`;
    await inTenant(tenantId, (s) => s.recordResult({ ok: false, error }, now()));
    return { status: "error", error };
  }
  const at = now();
  await inTenant(tenantId, async (s) => {
    for (let i = 0; i < rows.length; i += META_ADS_UPSERT_BATCH) await s.upsertDaily(conn.adAccountId, rows.slice(i, i + META_ADS_UPSERT_BATCH), at);
    await s.recordResult({ ok: true, currency: rows[0]?.currency ?? conn.currency }, at);
  });
  return { status: "ok", rows: rows.length };
}

export interface MetaAdsTickResult {
  tenants: number;
  ok: number;
  failed: number;
}

/** Every active connection, one tenant at a time; a failing tenant never stops the others. */
export async function runMetaAdsTick(deps: MetaAdsSyncDeps): Promise<MetaAdsTickResult> {
  const logger = deps.logger ?? silent;
  const listTenants =
    deps.listTenants ??
    (async () => (await deps.db.execute<{ tenant_id: string }>(sql`select tenant_id from meta_ads_tenant_ids()`)).map((r) => r.tenant_id));
  const ids = await listTenants();
  const res: MetaAdsTickResult = { tenants: ids.length, ok: 0, failed: 0 };
  for (const tenantId of ids) {
    try {
      const r = await syncMetaAdsTenant(deps, tenantId);
      if (r.status === "error") res.failed++;
      else res.ok++;
    } catch (err) {
      res.failed++;
      logger.warn(`meta ads sync failed for a tenant (${err instanceof Error ? err.name : "unknown"})`);
    }
  }
  return res;
}

/** Postgres adapter; `tx` comes from withTenant, so RLS scopes every statement. */
export function createPgMetaAdsStore(tx: Transaction, tenantId: string): MetaAdsStore {
  return {
    async loadConnection() {
      const [c] = await tx
        .select({ adAccountId: metaAdsConnections.adAccountId, currency: metaAdsConnections.currency, token: metaAdsConnections.accessTokenEncrypted })
        .from(metaAdsConnections)
        .where(eq(metaAdsConnections.status, "active"))
        .limit(1);
      return c ? { adAccountId: c.adAccountId, currency: c.currency?.trim() ?? null, accessTokenEncrypted: c.token } : null;
    },
    async upsertDaily(adAccountId, rows, now) {
      if (rows.length === 0) return;
      await tx
        .insert(adSpendDaily)
        .values(rows.map((r) => ({ tenantId, adAccountId, ...r, syncedAt: now })))
        .onConflictDoUpdate({
          target: [adSpendDaily.tenantId, adSpendDaily.adId, adSpendDaily.date],
          set: {
            spendMinor: sql`excluded.spend_minor`,
            currency: sql`excluded.currency`,
            impressions: sql`excluded.impressions`,
            clicks: sql`excluded.clicks`,
            metaConversations: sql`excluded.meta_conversations`,
            adName: sql`excluded.ad_name`,
            adsetId: sql`excluded.adset_id`,
            adsetName: sql`excluded.adset_name`,
            campaignId: sql`excluded.campaign_id`,
            campaignName: sql`excluded.campaign_name`,
            adAccountId: sql`excluded.ad_account_id`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
    },
    async recordResult(result, now) {
      await tx
        .update(metaAdsConnections)
        .set(
          result.ok
            ? { lastSyncAt: now, lastSyncStatus: "ok", lastSyncError: null, ...(result.currency ? { currency: result.currency } : {}) }
            : { lastSyncAt: now, lastSyncStatus: "error", lastSyncError: result.error.slice(0, 200) },
        )
        .where(eq(metaAdsConnections.tenantId, tenantId));
    },
  };
}
