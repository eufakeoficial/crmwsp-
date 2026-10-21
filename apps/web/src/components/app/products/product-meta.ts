import type { Product } from "@crmwsp/contracts";

export const KIND_LABELS: Record<Product["kind"], string> = {
  physical: "Físico",
  service: "Servicio",
  digital: "Digital",
};

export const STATUS_LABELS: Record<Product["status"], string> = {
  draft: "Borrador",
  active: "Activo",
  archived: "Archivado",
};

/** "Talla: M, Color: Rojo"; the default variant (no options) reads "Variante única". */
export function optionsLabel(options: Record<string, string>): string {
  const entries = Object.entries(options);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(", ") : "Variante única";
}
