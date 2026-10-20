import type { QuoteItem } from "./types";

/**
 * Money math for quotes. Everything is integer arithmetic on minor units
 * (cents); percentages become basis points (1% = 100 bps) and quantities
 * thousandths. BigInt is used for intermediate products so large amounts
 * cannot lose precision. No floats ever touch money.
 *
 * Rounding: half-even (banker's rounding) on every division, applied
 * per line in this order:
 *   gross    = round(quantity * unitPrice)
 *   discount = round(gross * discountBps / 10_000)
 *   net      = gross - discount
 *   tax      = round(net * taxBps / 10_000)
 * Taxes are rounded per line, then summed per rate.
 */

/** Divides non-negative `n` by positive `d`, rounding half to even. */
export function divRoundHalfEven(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new RangeError("divRoundHalfEven expects n >= 0 and d > 0");
  const q = n / d;
  const twiceRem = (n % d) * 2n;
  if (twiceRem > d) return q + 1n;
  if (twiceRem < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

/** Percentage (max 2 decimals) to integer basis points. */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
  taxBps: number;
}

export interface TaxGroup {
  ratePercent: number;
  baseMinor: number;
  taxMinor: number;
}

export interface QuoteTotals {
  lines: LineTotals[];
  /** Sum of gross line amounts, before discounts. */
  subtotalMinor: number;
  discountTotalMinor: number;
  /** Subtotal minus discounts (taxable base). */
  netTotalMinor: number;
  /** One entry per distinct tax rate, ascending. Rate 0 is included only if used explicitly. */
  taxes: TaxGroup[];
  taxTotalMinor: number;
  totalMinor: number;
}

export function computeQuoteTotals(items: readonly QuoteItem[]): QuoteTotals {
  const lines: LineTotals[] = [];
  const groups = new Map<number, { base: bigint; tax: bigint }>();
  let subtotal = 0n;
  let discountTotal = 0n;
  let taxTotal = 0n;

  for (const item of items) {
    const qtyMilli = BigInt(Math.round(item.quantity * 1000));
    const gross = divRoundHalfEven(qtyMilli * BigInt(item.unitPriceMinor), 1000n);
    const discount = divRoundHalfEven(
      gross * BigInt(percentToBps(item.discountPercent ?? 0)),
      10_000n,
    );
    const net = gross - discount;
    const taxBps = percentToBps(item.taxRatePercent ?? 0);
    const tax = divRoundHalfEven(net * BigInt(taxBps), 10_000n);

    subtotal += gross;
    discountTotal += discount;
    taxTotal += tax;
    if (item.taxRatePercent !== undefined) {
      const g = groups.get(taxBps) ?? { base: 0n, tax: 0n };
      g.base += net;
      g.tax += tax;
      groups.set(taxBps, g);
    }
    lines.push({
      grossMinor: Number(gross),
      discountMinor: Number(discount),
      netMinor: Number(net),
      taxMinor: Number(tax),
      totalMinor: Number(net + tax),
      taxBps,
    });
  }

  const taxes = [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([bps, g]) => ({
      ratePercent: bps / 100,
      baseMinor: Number(g.base),
      taxMinor: Number(g.tax),
    }));
  const net = subtotal - discountTotal;
  return {
    lines,
    subtotalMinor: Number(subtotal),
    discountTotalMinor: Number(discountTotal),
    netTotalMinor: Number(net),
    taxes,
    taxTotalMinor: Number(taxTotal),
    totalMinor: Number(net + taxTotal),
  };
}
