/** Currency symbol / token -> ISO code. `null` marks a symbol that is ambiguous on its own. */
const SYMBOLS: Array<[string, string | null]> = [
  ["us$", "USD"],
  ["r$", "BRL"],
  ["s/", "PEN"],
  ["bs.", "BOB"],
  ["bs", "BOB"],
  ["€", "EUR"],
  ["£", "GBP"],
  ["$", null],
];

const WORD_CURRENCIES: Record<string, string> = {
  euro: "EUR",
  euros: "EUR",
  dolar: "USD",
  dolares: "USD",
  dollar: "USD",
  dollars: "USD",
  boliviano: "BOB",
  bolivianos: "BOB",
  libra: "GBP",
  libras: "GBP",
};

let isoCodes: Set<string> | null = null;
/** True for codes Intl knows as currencies (rejects words like "por" or "con"). */
export function isIsoCurrency(code: string): boolean {
  isoCodes ??= new Set(Intl.supportedValuesOf("currency"));
  return isoCodes.has(code.toUpperCase());
}

function strip(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Normalizes a currency cell ("eur", "€", "Euros") to an ISO-like code, or null if unknown/ambiguous. */
export function normalizeCurrency(raw: string): string | null {
  const v = strip(raw.trim().toLowerCase());
  if (!v) return null;
  if (/^[a-z]{3}$/.test(v)) return isIsoCurrency(v) ? v.toUpperCase() : null;
  const word = WORD_CURRENCIES[v];
  if (word) return word;
  for (const [sym, code] of SYMBOLS) if (v === sym) return code;
  return null;
}

/** ISO 4217 minor-unit digits (CLP/JPY/PYG: 0, BHD/KWD/TND: 3, most: 2). */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** Which character a file uses as decimal separator; null = unknown. */
export type DecimalSeparator = "." | "," | null;

export type PriceResult =
  | {
      ok: true;
      /** Digits and separators only, e.g. "1.234,56". Convert with `toMinor` once the currency is known. */
      number: string;
      currency: string | null;
      ambiguousSymbol?: true;
    }
  | { ok: false; reason: string };

export type MinorResult = { ok: true; minor: number } | { ok: false; reason: string };

/**
 * Evidence a number gives about the file's decimal separator, independent of currency:
 * "1.234,56" -> ",", "1.234.567" -> ",", "12,50" -> ",". A single separator followed by
 * exactly 3 digits ("1.234") gives no evidence.
 */
export function decimalEvidence(num: string): DecimalSeparator {
  const dots = num.split(".").length - 1;
  const commas = num.split(",").length - 1;
  if (dots && commas) return num.lastIndexOf(".") > num.lastIndexOf(",") ? "." : ",";
  if (!dots && !commas) return null;
  const sep = dots ? "." : ",";
  if (dots + commas > 1) return sep === "." ? "," : ".";
  const after = num.slice(num.indexOf(sep) + 1);
  return after.length === 3 ? null : sep;
}

/**
 * Converts a digits+separators string to integer minor units using the currency's ISO decimals.
 * No floats: integer and fraction parts are handled as digit strings.
 * `convention` is the file-wide decimal separator, used only to resolve "1.234"/"12,500".
 */
export function toMinor(num: string, currency: string, convention: DecimalSeparator = null): MinorResult {
  const invalid = { ok: false as const, reason: `invalid price "${num}"` };
  if (!/^\d[\d.,]*$/.test(num)) return invalid;
  const decimals = currencyDecimals(currency);
  const dots = num.split(".").length - 1;
  const commas = num.split(",").length - 1;
  let decSep: "." | "," | null;
  if (dots && commas) decSep = num.lastIndexOf(".") > num.lastIndexOf(",") ? "." : ",";
  else if (!dots && !commas) decSep = null;
  else {
    const sep = dots ? "." : ",";
    if (dots + commas > 1) decSep = null; // repeated -> thousands
    else {
      const idx = num.indexOf(sep);
      const before = num.slice(0, idx);
      const after = num.slice(idx + 1);
      if (after.length !== 3 || before === "0") decSep = sep;
      else if (decimals === 0) decSep = null; // "12.500" CLP: no fraction possible
      else if (convention) decSep = convention === sep ? sep : null;
      else return { ok: false, reason: "ambiguous_number_format" };
    }
  }
  let intPart = num;
  let frac = "";
  if (decSep) {
    const i = num.lastIndexOf(decSep);
    intPart = num.slice(0, i);
    frac = num.slice(i + 1);
    if (!frac) return invalid;
  }
  const thousandsSep = decSep === "." ? "," : decSep === "," ? "." : null;
  if (decSep && intPart.includes(decSep)) return invalid;
  intPart = thousandsSep ? intPart.split(thousandsSep).join("") : intPart.replace(/[.,]/g, "");
  if (!/^\d+$/.test(intPart || "0") || (frac && !/^\d+$/.test(frac))) return invalid;
  if (frac.length > decimals) {
    // Extra precision is only accepted when it is all zeros.
    if (!/^0+$/.test(frac.slice(decimals))) return { ok: false, reason: `too many decimals for ${currency} in "${num}"` };
    frac = frac.slice(0, decimals);
  }
  const digits = ((intPart || "0") + frac.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return { ok: false, reason: `price too large "${num}"` };
  const minor = Number.parseInt(digits, 10);
  return Number.isSafeInteger(minor) ? { ok: true, minor } : { ok: false, reason: `price too large "${num}"` };
}

/** Parses "1.234,56", "1,234.56", "Bs 400", "€ 12,50", "12 EUR", ... */
export function parsePrice(raw: string): PriceResult {
  let s = raw.trim();
  if (!s) return { ok: false, reason: "empty price" };
  let currency: string | null = null;
  let ambiguous = false;
  const lower = s.toLowerCase();

  const code = /(?:^|[^a-z])([a-z]{3})(?:[^a-z]|$)/i.exec(strip(s));
  if (code?.[1] && isIsoCurrency(code[1])) {
    currency = code[1].toUpperCase();
    s = s.replace(new RegExp(code[1], "i"), " ");
  } else {
    for (const [sym, iso] of SYMBOLS) {
      if (lower.includes(sym)) {
        if (iso) currency = iso;
        else ambiguous = true;
        s = s.replace(new RegExp(sym.replace(/[$.]/g, "\\$&"), "i"), " ");
        break;
      }
    }
  }
  s = s.trim();
  const negative = /^-/.test(s);
  if (negative) return { ok: false, reason: "negative price" };
  const num = s.replace(/\s+/g, "");
  if (!/^\d[\d.,]*$/.test(num)) return { ok: false, reason: `invalid price "${raw.trim()}"` };
  return ambiguous ? { ok: true, number: num, currency, ambiguousSymbol: true } : { ok: true, number: num, currency };
}

/** Formats minor units with the currency's ISO decimals: (78000, EUR) -> "780", (1250, EUR) -> "12.50", (1500, CLP) -> "1500". */
export function formatMinor(minor: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  const digits = String(minor).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return !frac || /^0+$/.test(frac) ? whole : `${whole}.${frac}`;
}
