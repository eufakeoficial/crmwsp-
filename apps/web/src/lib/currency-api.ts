"use client";

import { useEffect, useState } from "react";
import {
  SUPPORTED_CURRENCIES,
  currencySettingsSchema,
  type CurrencySettings,
  type PatchCurrencySettingsRequest,
} from "@crmwsp/contracts";
import { request } from "./api";
import { CURRENCY_LOCALES, formatMoney } from "./format";

export const currencyApi = {
  get: (): Promise<CurrencySettings> => request("/settings/currency", { schema: currencySettingsSchema }),
  patch: (body: PatchCurrencySettingsRequest): Promise<CurrencySettings> =>
    request("/settings/currency", { method: "PATCH", body, schema: currencySettingsSchema }),
};

/** Spanish name of a curated currency, or the code itself. */
export function currencyName(code: string): string {
  return SUPPORTED_CURRENCIES.find((c) => c.code === code)?.name ?? code;
}

/** Narrow symbol from Intl ("S/", "$", "€"). */
export function currencySymbol(code: string, locale = CURRENCY_LOCALES[code] ?? "es"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency")?.value ?? code;
  } catch {
    return code;
  }
}

/** Example price formatted in the currency, e.g. "S/ 1.234,50". */
export function currencyExample(code: string, locale?: string): string {
  return formatMoney(1234.5, code, locale);
}

/**
 * Options for a currency select: enabled currencies with the base first, plus `current` when a
 * record already uses a currency that is no longer enabled (records keep their own currency).
 */
export function currencyOptions(settings: CurrencySettings | undefined, current?: string): string[] {
  const list = settings ? [settings.base, ...settings.enabled.filter((c) => c !== settings.base)] : [];
  if (current && !list.includes(current)) list.push(current);
  return list.length > 0 ? list : [current ?? "EUR"];
}

/** Default currency for new records: the tenant base. */
export function defaultCurrency(settings: CurrencySettings | undefined, fallback = "EUR"): string {
  return settings?.base ?? fallback;
}

/** Loads the tenant currency settings once; undefined while loading or on error. */
export function useCurrencySettings(): CurrencySettings | undefined {
  const [settings, setSettings] = useState<CurrencySettings>();
  useEffect(() => {
    let alive = true;
    currencyApi.get().then((s) => alive && setSettings(s), () => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return settings;
}
