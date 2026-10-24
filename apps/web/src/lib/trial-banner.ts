import type { BillingPlanResponse } from "@crmwsp/contracts";

export type Subscription = BillingPlanResponse["subscription"];

/** Pure text of the banner (ADR 0015); null when nothing must be shown. */
export function trialBannerText(s: Subscription): string | null {
  const d = s.daysLeft ?? 0;
  const days = `${d} ${d === 1 ? "día" : "días"}`;
  if (s.access === "setup") return `Conecta tu WhatsApp para empezar tu prueba: te quedan ${days} para conectar.`;
  if (s.access === "trial") return `Prueba gratuita: te quedan ${days} de prueba.`;
  if (s.access === "payment_required") return "Este número ya usó su prueba gratuita. Activa un plan para continuar.";
  if (s.access === "grace") return "Tu período terminó: estás en días de gracia. Paga tu plan para no perder el acceso.";
  if (s.access === "restricted") return "Tu cuenta está en solo lectura. Activa un plan para continuar; tus datos se conservan.";
  return null;
}

