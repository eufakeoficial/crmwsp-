/**
 * Meta Ads spend helpers and the "escalar / pausar / observar" recommendation rules. Pure: no I/O.
 * Recommendations are advisory only; nothing is ever changed in Meta automatically.
 */
import { currencyExponent, minorToMajor } from "./index.js";

export type AdRecommendationAction = "scale" | "pause" | "observe";

export interface AdRecommendation {
  action: AdRecommendationAction;
  /** Spanish, explainable, with the numbers used. */
  reason: string;
}

export interface AdRecommendationThresholds {
  /** ROAS in basis points (300 = 3.00x). */
  targetRoasBp: number;
  breakEvenRoasBp: number;
  /** Account-currency minor units. */
  minSpendMinor: number;
  minConversations: number;
  pauseSpendMinor: number;
}

export const DEFAULT_AD_RECOMMENDATION_THRESHOLDS: AdRecommendationThresholds = {
  targetRoasBp: 300,
  breakEvenRoasBp: 100,
  minSpendMinor: 2000,
  minConversations: 5,
  pauseSpendMinor: 5000,
};

/** Days that make a trend "stable". */
export const AD_STABILITY_DAYS = 7;

export interface AdWindowStats {
  spendMinor: number;
  /** Verified revenue in the spend currency (0 when none). */
  revenueMinor: number;
  purchases: number;
  conversations: number;
}

export interface AdRecommendationInput {
  /** Spend currency (ad account currency). */
  currency: string;
  /** True when the spend comes from the daily Meta sync for the range. */
  hasDailySpend: boolean;
  /** Currencies of verified revenue that differ from the spend currency (ROAS impossible). */
  otherRevenueCurrencies: string[];
  period: AdWindowStats;
  /** Last AD_STABILITY_DAYS days of the range. */
  last7: AdWindowStats;
  /** Days with synced spend rows in the last AD_STABILITY_DAYS days. */
  last7DaysWithData: number;
}

/** Meta returns spend as a major-unit decimal string ("12.34"). Exact conversion, no float math. */
export function metaSpendToMinor(spend: unknown, currency: string): number {
  if (typeof spend !== "string" && typeof spend !== "number") return 0;
  const s = String(spend).trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return 0;
  const exp = currencyExponent(currency);
  const frac = (m[2] ?? "").padEnd(exp + 1, "0");
  const base = Number(m[1]) * 10 ** exp + Number(frac.slice(0, exp) || "0");
  // Round half up on the first dropped digit.
  return base + (Number(frac[exp] ?? "0") >= 5 ? 1 : 0);
}

/** Cost per unit (integer minor units, rounded), null when the count is 0. */
export function costPerMinor(spendMinor: number, count: number): number | null {
  return count > 0 ? Math.round(spendMinor / count) : null;
}

/** ROAS in basis points, null without spend. */
export function roasBasisPoints(revenueMinor: number, spendMinor: number): number | null {
  return spendMinor > 0 ? Math.round((revenueMinor * 100) / spendMinor) : null;
}

const fmtMoney = (minor: number, currency: string) => `${minorToMajor(minor, currency).toFixed(currencyExponent(currency))} ${currency}`;
const fmtRoas = (bp: number) => `${(bp / 100).toFixed(2)}×`;

/**
 * Decision order: missing daily data → currency mismatch → spend without purchases → not enough
 * data → ROAS below break-even (period AND last 7 days) → ROAS at/above target (period AND last 7
 * days, with 7 days of data) → otherwise observe.
 */
export function recommendAd(input: AdRecommendationInput, t: AdRecommendationThresholds = DEFAULT_AD_RECOMMENDATION_THRESHOLDS): AdRecommendation {
  const { currency, period, last7 } = input;
  const money = (n: number) => fmtMoney(n, currency);
  if (!input.hasDailySpend) {
    return { action: "observe", reason: "Sin gasto diario sincronizado desde Meta en este periodo: conecta la cuenta publicitaria o pulsa «Sincronizar ahora»." };
  }
  if (input.otherRevenueCurrencies.length > 0 && period.revenueMinor === 0) {
    return {
      action: "observe",
      reason: `La inversión está en ${currency} y los ingresos en ${input.otherRevenueCurrencies.join(", ")}: no se calcula ROAS (no convertimos monedas).`,
    };
  }
  if (period.spendMinor >= t.pauseSpendMinor && period.purchases === 0) {
    return { action: "pause", reason: `Gastó ${money(period.spendMinor)} sin ninguna compra verificada (umbral para pausar: ${money(t.pauseSpendMinor)}).` };
  }
  if (period.spendMinor < t.minSpendMinor || period.conversations < t.minConversations) {
    return {
      action: "observe",
      reason: `Datos insuficientes: inversión ${money(period.spendMinor)} (mínimo ${money(t.minSpendMinor)}) y ${period.conversations} conversaciones (mínimo ${t.minConversations}).`,
    };
  }
  const roas = roasBasisPoints(period.revenueMinor, period.spendMinor) ?? 0;
  const roas7 = roasBasisPoints(last7.revenueMinor, last7.spendMinor);
  const r7 = roas7 === null ? "sin gasto" : fmtRoas(roas7);
  if (roas < t.breakEvenRoasBp && roas7 !== null && roas7 < t.breakEvenRoasBp) {
    return {
      action: "pause",
      reason: `ROAS ${fmtRoas(roas)} en el periodo y ${r7} en los últimos 7 días, por debajo del punto de equilibrio ${fmtRoas(t.breakEvenRoasBp)} (inversión ${money(period.spendMinor)}, ingresos verificados ${money(period.revenueMinor)}).`,
    };
  }
  if (roas >= t.targetRoasBp && roas7 !== null && roas7 >= t.targetRoasBp) {
    if (input.last7DaysWithData < AD_STABILITY_DAYS) {
      return {
        action: "observe",
        reason: `ROAS ${fmtRoas(roas)} supera el objetivo ${fmtRoas(t.targetRoasBp)}, pero solo hay ${input.last7DaysWithData} de ${AD_STABILITY_DAYS} días de datos recientes: espera a confirmar que es estable.`,
      };
    }
    return {
      action: "scale",
      reason: `ROAS ${fmtRoas(roas)} en el periodo y ${r7} en los últimos 7 días, por encima del objetivo ${fmtRoas(t.targetRoasBp)} (inversión ${money(period.spendMinor)}, ingresos verificados ${money(period.revenueMinor)}, ${period.purchases} compras).`,
    };
  }
  return {
    action: "observe",
    reason: `ROAS ${fmtRoas(roas)} en el periodo y ${r7} en los últimos 7 días: entre el punto de equilibrio ${fmtRoas(t.breakEvenRoasBp)} y el objetivo ${fmtRoas(t.targetRoasBp)}, o sin tendencia estable.`,
  };
}
