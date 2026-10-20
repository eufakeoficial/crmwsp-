/**
 * Integer money math for document lines (quotes and orders), BigInt only. Same rule as
 * `computeLineTotal` in @crmwsp/db (parity-tested in the API) and `computeQuoteTotals` in @crmwsp/pdf:
 *   gross = round(qtyMilli * unit / 1000); discount = round(gross * discountBp / 10000);
 *   net = gross - discount; tax = round(net * taxBp / 10000); total = net + tax   (half-even)
 */
export function divRoundHalfEven(n: bigint, d: bigint): bigint {
  if (d <= 0n || n < 0n) throw new RangeError("divRoundHalfEven expects n >= 0 and d > 0");
  const q = n / d;
  const twiceRem = (n % d) * 2n;
  if (twiceRem > d) return q + 1n;
  if (twiceRem < d) return q;
  return q % 2n === 0n ? q : q + 1n;
}

export interface LineBreakdown {
  gross: bigint;
  discount: bigint;
  net: bigint;
  tax: bigint;
  total: bigint;
}

export function computeLineBreakdown(quantityMilli: bigint, unitPriceMinor: bigint, discountBp = 0, taxRateBp = 0): LineBreakdown {
  if (quantityMilli <= 0n) throw new RangeError("quantityMilli must be > 0");
  if (unitPriceMinor < 0n) throw new RangeError("unitPriceMinor must be >= 0");
  for (const bp of [discountBp, taxRateBp]) {
    if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) throw new RangeError("basis points must be an integer in 0..10000");
  }
  const gross = divRoundHalfEven(quantityMilli * unitPriceMinor, 1000n);
  const discount = divRoundHalfEven(gross * BigInt(discountBp), 10_000n);
  const net = gross - discount;
  const tax = divRoundHalfEven(net * BigInt(taxRateBp), 10_000n);
  return { gross, discount, net, tax, total: net + tax };
}

export interface DocumentTotals {
  subtotal: bigint;
  discount: bigint;
  tax: bigint;
  total: bigint;
}

/** Sums line breakdowns; `shipping` (already tax-inclusive/exempt) is added to the total only. */
export function sumLines(lines: readonly LineBreakdown[], shipping = 0n): DocumentTotals {
  let subtotal = 0n;
  let discount = 0n;
  let tax = 0n;
  let total = 0n;
  for (const l of lines) {
    subtotal += l.gross;
    discount += l.discount;
    tax += l.tax;
    total += l.total;
  }
  return { subtotal, discount, tax, total: total + shipping };
}
