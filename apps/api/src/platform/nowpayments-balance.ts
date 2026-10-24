/**
 * Read-only NOWPayments account balance for the platform backoffice (ADR 0018).
 *
 * Official API (https://documenter.getpostman.com/view/7907941/2s93JusNJt, "Authentication" and
 * "Get balance"): `GET {base}/balance` needs the `x-api-key` header AND `Authorization: Bearer
 * <JWT>`; the JWT comes from `POST {base}/auth` with the account `email` and `password` and
 * expires after 5 minutes. Credentials come from env only, are never logged, and the JWT lives
 * in memory only. This module has NO payout/withdraw call on purpose.
 */

export interface BalanceItem {
  currency: string;
  amount: string;
  pendingAmount: string;
}

export type BalanceResult =
  | { configured: false }
  | { configured: true; ok: true; items: BalanceItem[]; fetchedAt: string }
  | { configured: true; ok: false; error: "auth_failed" | "unavailable"; fetchedAt: string };

export interface NowPaymentsBalanceOptions {
  apiKey: string;
  email: string;
  password: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => number;
  cacheMs?: number;
}

/** From env: NOWPAYMENTS_API_KEY + NOWPAYMENTS_EMAIL + NOWPAYMENTS_PASSWORD (all required). */
export function balanceOptionsFromEnv(env: Record<string, string | undefined>): NowPaymentsBalanceOptions | null {
  const apiKey = env["NOWPAYMENTS_API_KEY"];
  const email = env["NOWPAYMENTS_EMAIL"];
  const password = env["NOWPAYMENTS_PASSWORD"];
  if (!apiKey || !email || !password) return null;
  return { apiKey, email, password, ...(env["NOWPAYMENTS_API_BASE"] ? { baseUrl: env["NOWPAYMENTS_API_BASE"] } : {}) };
}

const num = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && /^-?\d+(\.\d+)?(e-?\d+)?$/i.test(v.trim())) return v.trim();
  return null;
};

/** `{ "usdtbsc": { "amount": 1.5, "pendingAmount": 0 }, ... }` → sorted items (junk skipped). */
export function parseBalance(body: unknown): BalanceItem[] {
  if (!body || typeof body !== "object" || Array.isArray(body)) return [];
  const items: BalanceItem[] = [];
  for (const [currency, v] of Object.entries(body as Record<string, unknown>)) {
    if (!/^[a-z0-9]{2,20}$/i.test(currency) || !v || typeof v !== "object") continue;
    const amount = num((v as Record<string, unknown>)["amount"]);
    if (amount === null) continue;
    items.push({ currency: currency.toLowerCase(), amount, pendingAmount: num((v as Record<string, unknown>)["pendingAmount"]) ?? "0" });
  }
  return items.sort((a, b) => a.currency.localeCompare(b.currency));
}

const JWT_TTL_MS = 4 * 60_000; // provider TTL is 5 min; refresh early
export const BALANCE_CACHE_MS = 60_000;
/** Manual refresh cannot hit the provider more often than this. */
export const BALANCE_MIN_REFRESH_MS = 10_000;

export class NowPaymentsBalanceClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly cacheMs: number;
  private jwt: { token: string; until: number } | null = null;
  private cache: { at: number; value: BalanceResult } | null = null;
  private inflight: Promise<BalanceResult> | null = null;

  constructor(private readonly opts: NowPaymentsBalanceOptions) {
    this.base = (opts.baseUrl ?? "https://api.nowpayments.io/v1").replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? fetch;
    this.now = opts.now ?? Date.now;
    this.cacheMs = opts.cacheMs ?? BALANCE_CACHE_MS;
  }

  /** Cached 60 s; `refresh` bypasses the cache (at most once every 10 s). */
  async balance(refresh = false): Promise<BalanceResult> {
    const age = this.cache ? this.now() - this.cache.at : Number.POSITIVE_INFINITY;
    if (this.cache && (age < (refresh ? BALANCE_MIN_REFRESH_MS : this.cacheMs))) return this.cache.value;
    this.inflight ??= this.load().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async load(): Promise<BalanceResult> {
    const fetchedAt = new Date(this.now()).toISOString();
    let value: BalanceResult;
    try {
      let res = await this.getBalance(await this.token());
      if (res.status === 401 || res.status === 403) {
        this.jwt = null; // expired early: one retry with a fresh token
        res = await this.getBalance(await this.token());
      }
      value = res.ok
        ? { configured: true, ok: true, items: parseBalance(await res.json()), fetchedAt }
        : { configured: true, ok: false, error: res.status === 401 || res.status === 403 ? "auth_failed" : "unavailable", fetchedAt };
    } catch (err) {
      value = { configured: true, ok: false, error: err instanceof AuthFailed ? "auth_failed" : "unavailable", fetchedAt };
    }
    this.cache = { at: this.now(), value };
    return value;
  }

  private getBalance(token: string): Promise<Response> {
    return this.fetchFn(`${this.base}/balance`, {
      headers: { "x-api-key": this.opts.apiKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  }

  private async token(): Promise<string> {
    if (this.jwt && this.jwt.until > this.now()) return this.jwt.token;
    const res = await this.fetchFn(`${this.base}/auth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: this.opts.email, password: this.opts.password }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new AuthFailed();
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== "string" || !body.token) throw new AuthFailed();
    this.jwt = { token: body.token, until: this.now() + JWT_TTL_MS };
    return body.token;
  }
}

class AuthFailed extends Error {
  override name = "AuthFailed";
}
