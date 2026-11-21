/**
 * Public pricing, mirrored by hand from packages/billing/src/index.ts (the web app does not depend on
 * @crmwsp/billing). `pricing.test.ts` fails if the two drift apart.
 */
export interface PricingPlan {
  id: "start" | "pro";
  name: string;
  tagline: string;
  priceMonthlyUsd: number;
  priceAnnualUsd: number;
  seats: number;
  whatsappNumbers: number;
  contacts: number;
  /** `null` = not included in the plan. */
  broadcasts: number | null;
  highlight?: boolean;
}

export const PRICING_PLANS: readonly PricingPlan[] = [
  { id: "start", name: "Start", tagline: "Para empezar a vender por WhatsApp con tu equipo y la IA.", priceMonthlyUsd: 49, priceAnnualUsd: 490, seats: 5, whatsappNumbers: 2, contacts: 10_000, broadcasts: null },
  { id: "pro", name: "Pro", tagline: "Para equipos que además envían campañas y manejan más volumen.", priceMonthlyUsd: 89, priceAnnualUsd: 890, seats: 15, whatsappNumbers: 4, contacts: 30_000, broadcasts: 30_000, highlight: true },
];

export const PRICING_PERIOD_DAYS = 30;
export const PRICING_ANNUAL_BADGE = "2 meses gratis";
export const PRICING_PROMISES = "Sin recargo en WhatsApp · Sin permanencia · IA sin tope con tu propia clave";
export const PRICING_TRIAL_NOTE = "7 días de configuración + 7 días de prueba al conectar tu WhatsApp";

/** Source: docs/marketing/pagina-precios.md, section "Compáralo con el mercado". */
export const MARKET_COLUMNS = ["Mercado (referencia)", "Vende+ WSP"] as const;
export const MARKET_ROWS: readonly (readonly [string, string, string])[] = [
  ["Plan de entrada con WhatsApp", "USD 49–149 / mes (mediana USD 79)", "USD 49 / mes (Start, 5 usuarios)"],
  ["Agente de IA", "Add-on de USD 25–90 / mes en varias plataformas", "Incluido en el plan"],
  ["Recargo sobre mensajes de WhatsApp", "Algunos lo declaran (por ejemplo +20 %); otros no lo informan", "Ninguno"],
  ["Permanencia / cobro automático", "Varios exigen plazos mínimos o tarjeta", "Ninguno"],
  ["Pago en criptomonedas", "Ninguna página oficial revisada lo menciona", "Sí (USDT y otras)"],
];
export const MARKET_FOOTNOTE =
  "Referencias tomadas de las páginas oficiales de precios de 15 plataformas el 24/10/2026; Treble y Manychat no pudieron verificarse. Los precios de terceros cambian y se muestran sin convertir de moneda.";
