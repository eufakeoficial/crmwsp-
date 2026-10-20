import { META_ADS_GRAPH_API_VERSION, ValidationError, type MetaAdAccount } from "@crmwsp/contracts";

const GRAPH = "https://graph.facebook.com";
export const AD_ACCOUNTS_MAX_PAGES = 10;

export type MetaGetFetch = (url: string, init: { method: "GET"; headers: Record<string, string> }) => Promise<{ status: number; text(): Promise<string> }>;

export const defaultMetaFetch: MetaGetFetch = (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) });

/** Sanitized Meta failure: status + numeric code only (never the token nor Meta's message). */
export class MetaAdsUpstreamError extends ValidationError {
  constructor(readonly upstreamCode: string) {
    super(`Meta rejected the request (${upstreamCode})`);
  }
}

/**
 * Lists the ad accounts the token can read (`/me/adaccounts`). The token travels only in the
 * Authorization header, never in the URL; pagination is followed on the Graph host only.
 */
export async function listMetaAdAccounts(fetchImpl: MetaGetFetch, accessToken: string): Promise<MetaAdAccount[]> {
  const out: MetaAdAccount[] = [];
  let url: string | null = `${GRAPH}/${META_ADS_GRAPH_API_VERSION}/me/adaccounts?fields=id,name,currency,account_status&limit=100`;
  for (let page = 0; url && page < AD_ACCOUNTS_MAX_PAGES; page++) {
    let status = 0;
    let text = "";
    try {
      const res = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" } });
      status = res.status;
      text = await res.text();
    } catch (err) {
      throw new MetaAdsUpstreamError(`network:${err instanceof Error ? err.name : "unknown"}`);
    }
    let body: { data?: unknown; paging?: { next?: unknown }; error?: { code?: unknown } } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      // not JSON
    }
    if (status < 200 || status >= 300) {
      throw new MetaAdsUpstreamError(`http_${status}${typeof body.error?.code === "number" ? `:meta_${body.error.code}` : ""}`);
    }
    for (const raw of Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : []) {
      const id = typeof raw["id"] === "string" ? raw["id"] : "";
      if (!/^act_\d{1,32}$/.test(id)) continue;
      out.push({
        id,
        name: typeof raw["name"] === "string" ? raw["name"].slice(0, 200) : null,
        currency: typeof raw["currency"] === "string" && /^[A-Z]{3}$/.test(raw["currency"]) ? raw["currency"] : null,
        active: raw["account_status"] === 1,
      });
    }
    url = nextUrl(body.paging?.next);
  }
  return out;
}

function nextUrl(next: unknown): string | null {
  if (typeof next !== "string") return null;
  try {
    const u = new URL(next);
    if (u.protocol !== "https:" || u.host !== new URL(GRAPH).host) return null;
    u.searchParams.delete("access_token");
    return u.toString();
  } catch {
    return null;
  }
}
