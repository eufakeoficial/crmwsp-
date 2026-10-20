import type { AiAction } from "./ai-schemas";

export const APPROVALS_CHANGED = "crmwsp:approvals-changed";

const TYPE_LABELS: Readonly<Record<string, string>> = {
  apply_discount: "Descuento",
  create_quote: "Presupuesto",
  send_template: "Plantilla de WhatsApp",
  send_quote: "Envío de presupuesto",
};

export function actionTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replaceAll("_", " ");
}

/** One-line "key: value" summary entries of an action payload (scalars only). */
export function payloadSummary(payload: AiAction["payload"]): { label: string; value: string }[] {
  return Object.entries(payload)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([k, v]) => ({ label: k.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase()), value: String(v) }));
}
