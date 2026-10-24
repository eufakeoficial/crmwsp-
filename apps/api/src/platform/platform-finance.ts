import { Controller, Get, Inject, Injectable, Optional, Query, UseGuards } from "@nestjs/common";
import { NotFoundError, platformFinanceQuerySchema, type PlatformFinance } from "@crmwsp/contracts";
import { CurrentUser } from "../auth/decorators.js";
import { DB_HANDLE, type DbHandle, type RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { pgCode } from "../inbox/audit.js";
import { NowPaymentsBalanceClient, balanceOptionsFromEnv, type BalanceResult } from "./nowpayments-balance.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";

export const NOWPAYMENTS_BALANCE_CLIENT = Symbol("NOWPAYMENTS_BALANCE_CLIENT");

/** Null when NOWPAYMENTS_API_KEY / NOWPAYMENTS_EMAIL / NOWPAYMENTS_PASSWORD are not all set. */
export function balanceClientFromEnv(): NowPaymentsBalanceClient | null {
  const opts = balanceOptionsFromEnv(process.env);
  return opts ? new NowPaymentsBalanceClient(opts) : null;
}

type SummaryRow = { bucket: string; key: string; usd: string; crypto: string | null; n: number };

/**
 * Read-only "Finanzas" (ADR 0018): our own revenue (`platform_finance_summary`, 0073) plus the
 * live NOWPayments balance. There is deliberately no withdraw/payout operation anywhere here.
 */
@Injectable()
export class PlatformFinanceService {
  constructor(
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Optional() @Inject(NOWPAYMENTS_BALANCE_CLIENT) private readonly client: NowPaymentsBalanceClient | null,
  ) {}

  async finance(actor: string, refresh: boolean): Promise<PlatformFinance> {
    const rows = await this.handle.sql<SummaryRow[]>`select bucket, key, usd, crypto, n from public.platform_finance_summary(${actor})`.catch(
      (err: unknown) => {
        if (pgCode(err) === "42501") throw new NotFoundError();
        throw err;
      },
    );
    const balance: BalanceResult = this.client ? await this.client.balance(refresh) : { configured: false };
    const pick = (bucket: string) => rows.filter((r) => r.bucket === bucket).map((r) => ({ key: r.key, usd: r.usd, count: Number(r.n) }));
    const one = (bucket: string) => pick(bucket)[0] ?? { key: "", usd: "0", count: 0 };
    const balances = new Map(balance.configured && balance.ok ? balance.items.map((i) => [i.currency, i.amount]) : []);
    const currencies = new Set([...rows.filter((r) => r.bucket === "pay_currency").map((r) => r.key), ...balances.keys()]);
    return {
      revenue: {
        today: one("today"),
        month: one("month"),
        byPlan: pick("plan"),
        byPeriod: pick("period"),
        couponGrants: one("coupon_grants").count,
      },
      balance,
      reconciliation: [...currencies].sort().map((currency) => {
        const r = rows.find((x) => x.bucket === "pay_currency" && x.key === currency);
        const paidCrypto = r?.crypto ?? "0";
        const bal = balances.get(currency) ?? null;
        // Display hint only (float precision is fine here; settlement never uses this).
        const difference = bal === null ? null : (Number(bal) - Number(paidCrypto)).toFixed(8);
        return { currency, paidCrypto, paidUsd: r?.usd ?? "0", balance: bal, difference };
      }),
    };
  }
}

@Controller("platform/finance")
@UseGuards(PlatformAdminGuard)
export class PlatformFinanceController {
  constructor(@Inject(PlatformFinanceService) private readonly finance: PlatformFinanceService) {}

  /** GET /platform/finance[?refresh=1] — read-only; non-admins get 404. */
  @Get()
  get(@CurrentUser() user: RequestUser, @Query() query: unknown): Promise<PlatformFinance> {
    return this.finance.finance(user.id, parseOrThrow(platformFinanceQuerySchema, query).refresh === "1");
  }
}
