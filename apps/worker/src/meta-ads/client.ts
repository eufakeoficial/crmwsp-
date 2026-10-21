import { metaSpendToMinor } from "@crmwsp/domain";
import { META_GRAPH_API_VERSION, META_GRAPH_BASE_URL } from "../meta-capi/client.js";

/** GET-only fetch port (the global fetch fits). */
export type MetaGetFetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<{
  status: number;
  text(): Promise<string>;
}>;

export const INSIGHTS_FIELDS = "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,clicks,actions,account_currency,date_start";
export const INSIGHTS_PAGE_LIMIT = 500;
export const INSIGHTS_MAX_PAGES = 200;
/** Retries per request on rate limits (Meta codes 4/17/32/613/80000-80014) and transient errors. */
export const META_MAX_ATTEMPTS = 5;
const MESSAGING_ACTION = "onsite_conversion.messaging_conversation_started_7d";

/** Sanitized error: HTTP status + Meta numeric code only (never the token, URL or message). */
export class MetaAdsError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "MetaAdsError";
  }
}

export interface InsightRow {
  adId: string;
  date: string;
  spendMinor: number;
  currency: string;
  impressions: number;
  clicks: number;
  metaConversations: number;
  adName: string | null;
  adsetId: string | null;
  adsetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export function insightsUrl(adAccountId: string): string {
  if (!/^act_\d{1,32}$/.test(adAccountId)) throw new MetaAdsError("invalid_ad_account", false);
  const q = new URLSearchParams({
    level: "ad",
    time_increment: "1",
    fields: INSIGHTS_FIELDS,
    date_preset: "last_30d",
    limit: String(INSIGHTS_PAGE_LIMIT),
  });
  return `${META_GRAPH_BASE_URL}/${META_GRAPH_API_VERSION}/${adAccountId}/insights?${q.toString()}`;
}

/** Only follow `paging.next` on the Graph host, and never carry a token in the query string. */
export function safeNextUrl(next: unknown): string | null {
  if (typeof next !== "string") return null;
  let u: URL;
  try {
    u = new URL(next);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.host !== new URL(META_GRAPH_BASE_URL).host) return null;
  u.searchParams.delete("access_token");
  return u.toString();
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);
const isRateLimit = (code: number | undefined) => code !== undefined && (RATE_LIMIT_CODES.has(code) || (code >= 80000 && code <= 80014));

/** Backoff for attempt n (1-based): 2, 4, 8, 16 s… capped at 60 s. */
export function metaBackoffMs(attempt: number): number {
  return Math.min(2000 * 2 ** Math.max(0, attempt - 1), 60_000);
}

export interface MetaRequestDeps {
  fetch: MetaGetFetch;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET with the token in the Authorization header; retries rate limits and 5xx with backoff. */
export async function metaGet(deps: MetaRequestDeps, url: string, accessToken: string): Promise<unknown> {
  const sleep = deps.sleep ?? realSleep;
  let last = new MetaAdsError("unknown", true);
  for (let attempt = 1; attempt <= META_MAX_ATTEMPTS; attempt++) {
    let status = 0;
    let body = "";
    try {
      const res = await deps.fetch(url, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
      status = res.status;
      body = await res.text();
    } catch (err) {
      last = new MetaAdsError(`network:${err instanceof Error ? err.name : "unknown"}`, true);
    }
    if (status >= 200 && status < 300) {
      try {
        return JSON.parse(body) as unknown;
      } catch {
        throw new MetaAdsError(`http_${status}:invalid_json`, false);
      }
    }
    if (status !== 0) {
      let code: number | undefined;
      let sub: number | undefined;
      try {
        const e = (JSON.parse(body) as { error?: { code?: unknown; error_subcode?: unknown } }).error;
        if (typeof e?.code === "number") code = e.code;
        if (typeof e?.error_subcode === "number") sub = e.error_subcode;
      } catch {
        // not JSON: status only
      }
      const retryable = isRateLimit(code) || status === 429 || status >= 500;
      last = new MetaAdsError(`http_${status}${code !== undefined ? `:meta_${code}` : ""}${sub !== undefined ? `.${sub}` : ""}`, retryable);
    }
    if (!last.retryable || attempt === META_MAX_ATTEMPTS) throw last;
    await sleep(metaBackoffMs(attempt));
  }
  throw last;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : null);

export function parseInsightRow(raw: unknown, fallbackCurrency: string | null): InsightRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const adId = str(r["ad_id"]);
  const date = typeof r["date_start"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r["date_start"]) ? r["date_start"] : null;
  const cur = str(r["account_currency"])?.toUpperCase() ?? fallbackCurrency;
  if (!adId || !date || !cur || !/^[A-Z]{3}$/.test(cur)) return null;
  const actions = Array.isArray(r["actions"]) ? (r["actions"] as Array<Record<string, unknown>>) : [];
  return {
    adId,
    date,
    spendMinor: metaSpendToMinor(r["spend"], cur),
    currency: cur,
    impressions: num(r["impressions"]),
    clicks: num(r["clicks"]),
    metaConversations: num(actions.find((a) => a?.["action_type"] === MESSAGING_ACTION)?.["value"]),
    adName: str(r["ad_name"]),
    adsetId: str(r["adset_id"]),
    adsetName: str(r["adset_name"]),
    campaignId: str(r["campaign_id"]),
    campaignName: str(r["campaign_name"]),
  };
}

/** Every insights row of the last 30 days, following pagination. */
export async function fetchInsights(deps: MetaRequestDeps, adAccountId: string, accessToken: string, fallbackCurrency: string | null): Promise<InsightRow[]> {
  const out: InsightRow[] = [];
  let url: string | null = insightsUrl(adAccountId);
  for (let page = 0; url && page < INSIGHTS_MAX_PAGES; page++) {
    const body = (await metaGet(deps, url, accessToken)) as { data?: unknown; paging?: { next?: unknown } } | null;
    const data = Array.isArray(body?.data) ? body.data : [];
    for (const raw of data) {
      const row = parseInsightRow(raw, fallbackCurrency);
      if (row) out.push(row);
    }
    url = data.length > 0 ? safeNextUrl(body?.paging?.next) : null;
  }
  return out;
}
