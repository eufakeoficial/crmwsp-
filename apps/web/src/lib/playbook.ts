import type { ClosingStyle, SalesStage } from "@crmwsp/contracts";

export const STAGE_LABELS: Readonly<Record<SalesStage, string>> = {
  discovery: "Descubrimiento",
  proposal: "Propuesta",
  objections: "Objeciones",
  closing: "Cierre",
  followup: "Seguimiento",
};

export const STAGE_HINTS: Readonly<Record<SalesStage, string>> = {
  discovery: "Entender qué necesita el cliente antes de ofrecer nada.",
  proposal: "Recomendar la opción que encaja y explicar por qué.",
  objections: "Resolver dudas con información verificable, sin presionar.",
  closing: "Proponer un siguiente paso claro y pedir la decisión.",
  followup: "Retomar la conversación con algo útil si el cliente se enfría.",
};

export const CLOSING_LABELS: Readonly<Record<ClosingStyle, { title: string; hint: string }>> = {
  soft: { title: "Suave", hint: "Invita y deja que el cliente decida a su ritmo." },
  direct: { title: "Directo", hint: "Propone el siguiente paso y pide la decisión con claridad." },
};

/** Readable label for an objection id stored on a run ("es-caro" -> "Es caro"). */
export function objectionLabel(id: string): string {
  const text = id.replace(/[-_]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : id;
}

/** Stable id for a new objection, derived from its trigger and unique among `taken`. */
export function newObjectionId(trigger: string, taken: readonly string[]): string {
  const base =
    trigger
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30)
      .replace(/-+$/g, "") || "nueva";
  if (!taken.includes(base)) return base;
  for (let n = 2; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.includes(id)) return id;
  }
}

/** "3 de 10 (30 %)" style share; "—" when there is nothing to divide by. */
export function share(part: number, total: number): string {
  if (total <= 0) return "—";
  return `${part} (${Math.round((part / total) * 100)} %)`;
}
