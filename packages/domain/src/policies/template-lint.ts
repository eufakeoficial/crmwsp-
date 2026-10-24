/**
 * Pre-submit linter for WhatsApp message templates (ADR 0021, T2c). Heuristics from the Meta
 * policy research (§1.2, §4 "Plantillas"): it never replaces Meta's review, it catches the usual
 * rejection and pause causes before submitting. Errors block the submission; warnings do not.
 */

export type TemplateLintCategory = "marketing" | "utility" | "authentication";
export type TemplateLintLevel = "error" | "warning";
export type TemplateLintCode =
  | "prohibited_content"
  | "sensitive_data_request"
  | "variables_not_sequential"
  | "variable_at_edge"
  | "adjacent_variables"
  | "too_many_variables"
  | "marketing_missing_opt_out"
  | "promotional_in_utility"
  | "url_shortener";

export interface TemplateLintIssue {
  level: TemplateLintLevel;
  code: TemplateLintCode;
  message: string;
}

export interface TemplateLintResult {
  /** False when there is at least one error. */
  ok: boolean;
  issues: TemplateLintIssue[];
}

export interface TemplateLintInput {
  category: TemplateLintCategory;
  body: string;
}

/** Uppercase, accents and punctuation stripped, single spaces. */
function norm(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%{} ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

/** Whole-word (or whole-phrase) match on normalized text. */
const hasAny = (n: string, terms: readonly string[]) => terms.some((t) => n.includes(` ${t} `));

/** Prohibited verticals of the Messaging/Commerce policies (research §3), normalized. */
export const PROHIBITED_TEMPLATE_TERMS = [
  "criptomoneda",
  "criptomonedas",
  "bitcoin",
  "opciones binarias",
  "armas",
  "municion",
  "explosivos",
  "apuestas",
  "casino",
  "prestamo express",
  "prestamos express",
  "payday",
  "escort",
  "escorts",
  "contenido para adultos",
  "marihuana",
  "cocaina",
  "sin receta",
  "replica",
  "replicas",
  "falsificado",
  "falsificados",
  "tabaco",
  "vapeador",
] as const;

/** Requests for data the policy forbids asking for by chat (card, bank account, ID documents). */
export const SENSITIVE_REQUEST_TERMS = [
  "numero de tu tarjeta",
  "numero de la tarjeta",
  "numero de tarjeta",
  "datos de tu tarjeta",
  "cvv",
  "cvc",
  "codigo de seguridad de tu tarjeta",
  "numero de cuenta",
  "cuenta bancaria",
  "clave bancaria",
  "contrasena",
  "password",
  "pin de tu",
  "foto de tu documento",
  "foto de tu dni",
  "numero de tu documento",
] as const;

const OPT_OUT_TERMS = ["baja", "stop", "cancelar suscripcion", "no recibir mas", "darte de baja", "unsubscribe"] as const;
const PROMO_TERMS = ["descuento", "descuentos", "oferta", "ofertas", "promo", "promocion", "rebaja", "rebajas", "gratis", "aprovecha", "cupon"] as const;
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|goo\.gl|t\.co|cutt\.ly|ow\.ly|is\.gd|shorturl\.at|rb\.gy)\//i;

export function lintTemplate(input: TemplateLintInput): TemplateLintResult {
  const issues: TemplateLintIssue[] = [];
  const add = (level: TemplateLintLevel, code: TemplateLintCode, message: string) => issues.push({ level, code, message });
  const body = input.body.trim();
  const n = norm(body);

  if (hasAny(n, PROHIBITED_TEMPLATE_TERMS)) {
    add("error", "prohibited_content", "Menciona productos o servicios prohibidos por las políticas de WhatsApp Business.");
  }
  if (hasAny(n, SENSITIVE_REQUEST_TERMS)) {
    add("error", "sensitive_data_request", "No pidas por WhatsApp tarjetas, cuentas bancarias, contraseñas ni documentos de identidad.");
  }

  const vars = [...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]));
  const distinct = [...new Set(vars)].sort((a, b) => a - b);
  if (distinct.some((v, i) => v !== i + 1)) {
    add("error", "variables_not_sequential", "Las variables deben ser {{1}}, {{2}}, … sin saltos.");
  }
  if (/^\{\{\s*\d+\s*\}\}/.test(body) || /\{\{\s*\d+\s*\}\}[.!?\s]*$/.test(body)) {
    add("error", "variable_at_edge", "El texto no puede empezar ni terminar con una variable.");
  }
  if (/\}\}\s*\{\{/.test(body)) {
    add("error", "adjacent_variables", "Separa las variables con texto: Meta rechaza variables juntas.");
  }
  const words = body.replace(/\{\{\s*\d+\s*\}\}/g, " ").split(/\s+/).filter(Boolean).length;
  if (vars.length > 0 && words < vars.length * 3) {
    add("warning", "too_many_variables", "Hay demasiadas variables para la longitud del texto; Meta suele rechazarlo.");
  }

  if (input.category === "marketing" && !hasAny(n, OPT_OUT_TERMS)) {
    add("warning", "marketing_missing_opt_out", "Incluye cómo darse de baja (por ejemplo: «Responde BAJA para no recibir más»).");
  }
  if (input.category !== "marketing" && (hasAny(n, PROMO_TERMS) || /\d+\s*%/.test(body))) {
    add("warning", "promotional_in_utility", "Tiene lenguaje promocional: Meta puede reclasificarla como marketing o pausarla.");
  }
  if (SHORTENERS.test(body)) {
    add("warning", "url_shortener", "Evita acortadores de enlaces; usa el dominio completo de tu negocio.");
  }

  return { ok: !issues.some((i) => i.level === "error"), issues };
}
