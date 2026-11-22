import { billingRedirectSchema, cardBillingSchema, type BillingPeriodDto, type CardBilling } from "@crmwsp/contracts";
import { request } from "./api";

/** Card billing with Stripe (ADR 0022). The browser only ever follows Stripe-hosted pages. */
export const cardBillingApi = {
  status: () => request("/billing/card", { schema: cardBillingSchema }),
  checkout: (plan: "start" | "pro", period: BillingPeriodDto) =>
    request("/billing/card/checkout", { method: "POST", body: { plan, period }, schema: billingRedirectSchema }),
  portal: () => request("/billing/card/portal", { method: "POST", schema: billingRedirectSchema }),
};

export const CARD_STATUS_LABEL: Record<NonNullable<CardBilling["subscription"]>["status"], string> = {
  none: "Sin suscripción con tarjeta",
  incomplete: "Pago pendiente de confirmar",
  trialing: "En prueba",
  active: "Renovación automática activa",
  past_due: "Pago fallido: Stripe reintentará el cobro",
  unpaid: "Cobro impago",
  canceled: "Suscripción con tarjeta cancelada",
  paused: "Suscripción pausada",
};

/** Guards the redirect: only https pages hosted on stripe.com (checkout / billing portal). */
export function isStripeRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "stripe.com" || u.hostname.endsWith(".stripe.com"));
  } catch {
    return false;
  }
}

/** Periods with a configured Stripe price for a plan, in display order. */
export function cardPeriodsFor(available: Readonly<CardBilling["available"]>, plan: "start" | "pro"): BillingPeriodDto[] {
  return (["monthly", "annual"] as const).filter((period) => available.some((a) => a.plan === plan && a.period === period));
}

/** Message after Stripe sends the browser back; a success never means "paid" until the webhook arrives. */
export function cardReturnNotice(result: string | null): string | null {
  if (result === "success") return "Recibimos tu pago con tarjeta. Lo confirmaremos en unos minutos y se reflejará aquí.";
  if (result === "cancel") return "Cancelaste el pago con tarjeta. No se hizo ningún cobro.";
  return null;
}
