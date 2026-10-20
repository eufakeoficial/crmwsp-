/**
 * Line total for quote items, in minor units. Same rule as `computeQuoteTotals` in
 * `@crmwsp/pdf` (packages/pdf/src/totals.ts), per line and half-even on every division:
 *   gross    = round(quantityMilli * unitPriceMinor / 1000)
 *   discount = round(gross * discountBp / 10_000)
 *   net      = gross - discount
 *   tax      = round(net * taxRateBp / 10_000)
 *   total    = net + tax
 * It is a ~10-line pure function, duplicated on purpose: importing `@crmwsp/pdf` would pull
 * pdfkit and zod into the data package, and its API is float-based (quantity, percent),
 * while the DB stores milli-units and basis points. A parity test against the pdf package
 * guards against drift.
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

export function computeLineTotal(
  quantityMilli: bigint,
  unitPriceMinor: bigint,
  discountBp = 0,
  taxRateBp = 0,
): bigint {
  if (quantityMilli <= 0n) throw new RangeError("computeLineTotal: quantityMilli must be > 0");
  if (unitPriceMinor < 0n) throw new RangeError("computeLineTotal: unitPriceMinor must be >= 0");
  if (!Number.isInteger(discountBp) || discountBp < 0 || discountBp > 10_000) {
    throw new RangeError("computeLineTotal: discountBp must be an integer in 0..10000");
  }
  if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) {
    throw new RangeError("computeLineTotal: taxRateBp must be an integer in 0..10000");
  }
  const gross = divRoundHalfEven(quantityMilli * unitPriceMinor, 1000n);
  const discount = divRoundHalfEven(gross * BigInt(discountBp), 10_000n);
  const net = gross - discount;
  const tax = divRoundHalfEven(net * BigInt(taxRateBp), 10_000n);
  return net + tax;
}
