import { z } from "zod";

/**
 * Curated currencies a business can sell in (T28), LatAm first. The base currency of the tenant lives
 * in `tenants.currency`; the enabled list in `tenants.settings.currencies`. There is no FX in the
 * system: changing the base never converts or rewrites existing amounts.
 */
export const SUPPORTED_CURRENCIES = [
  { code: "PEN", name: "Sol peruano" },
  { code: "USD", name: "Dólar estadounidense" },
  { code: "EUR", name: "Euro" },
  { code: "MXN", name: "Peso mexicano" },
  { code: "COP", name: "Peso colombiano" },
  { code: "CLP", name: "Peso chileno" },
  { code: "ARS", name: "Peso argentino" },
  { code: "BOB", name: "Boliviano" },
  { code: "PYG", name: "Guaraní paraguayo" },
  { code: "UYU", name: "Peso uruguayo" },
  { code: "BRL", name: "Real brasileño" },
  { code: "GTQ", name: "Quetzal guatemalteco" },
  { code: "DOP", name: "Peso dominicano" },
  { code: "CRC", name: "Colón costarricense" },
] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number]["code"];
export const SUPPORTED_CURRENCY_CODES: readonly string[] = SUPPORTED_CURRENCIES.map((c) => c.code);

export const supportedCurrencySchema = z
  .string()
  .refine((c) => SUPPORTED_CURRENCY_CODES.includes(c), { message: "Currency not supported" });

export const currencySettingsSchema = z.object({
  /** Default for new products, quotes, orders, reports and filters. */
  base: z.string().length(3),
  /** Currencies the business sells in; base first. */
  enabled: z.array(z.string().length(3)).min(1),
});
export type CurrencySettings = z.infer<typeof currencySettingsSchema>;

export const patchCurrencySettingsRequestSchema = z
  .object({
    base: supportedCurrencySchema,
    enabled: z.array(supportedCurrencySchema).min(1).max(SUPPORTED_CURRENCIES.length),
  })
  .strict()
  .refine((v) => v.enabled.includes(v.base), { message: "Base currency must be enabled", path: ["base"] });
export type PatchCurrencySettingsRequest = z.infer<typeof patchCurrencySettingsRequestSchema>;

/** Keeps valid ISO codes, dedupes and puts the base first (always included). */
export function resolveCurrencySettings(base: string, stored: unknown): CurrencySettings {
  const list = Array.isArray(stored) ? stored.filter((c): c is string => typeof c === "string" && /^[A-Z]{3}$/.test(c)) : [];
  return { base, enabled: [...new Set([base, ...list])] };
}

/**
 * Mercado Pago charges only in the local currency of the seller account's country (MLA ARS, MLB BRL,
 * MLC CLP, MCO COP, MLM MXN, MPE PEN, MLU UYU). The account country is not stored, so we accept
 * that union and Mercado Pago itself rejects a mismatch with the account. Stripe supports every
 * ISO 4217 currency the system stores (presentment currencies), so it is not restricted here.
 */
export const MERCADOPAGO_CURRENCIES: readonly string[] = ["ARS", "BRL", "CLP", "COP", "MXN", "PEN", "UYU"];

export function providerSupportsCurrency(provider: "stripe" | "mercadopago", currency: string): boolean {
  return provider === "stripe" ? /^[A-Z]{3}$/.test(currency) : MERCADOPAGO_CURRENCIES.includes(currency);
}
