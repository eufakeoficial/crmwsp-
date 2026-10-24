import { submitTemplateRequestSchema, type SubmitTemplateRequest, type TemplateCategory, type TemplateStatus } from "@crmwsp/contracts";
import type { Tone } from "@/components/ui/tones";

/** Opt-out wording suggested for marketing templates. */
export const OPT_OUT_LINE = "Responde BAJA para no recibir más mensajes";

export const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  marketing: "Marketing",
  utility: "Utilidad",
  authentication: "Autenticación",
};

export const STATUS_META: Record<TemplateStatus, { label: string; tone: Tone }> = {
  approved: { label: "Aprobada", tone: "success" },
  pending: { label: "Pendiente", tone: "warning" },
  rejected: { label: "Rechazada", tone: "danger" },
  paused: { label: "Pausada", tone: "amber" },
  disabled: { label: "Deshabilitada", tone: "paper" },
};

export const LANGUAGE_OPTIONS: ReadonlyArray<{ code: string; label: string }> = [
  { code: "es", label: "Español" },
  { code: "es_AR", label: "Español (Argentina)" },
  { code: "es_MX", label: "Español (México)" },
  { code: "es_ES", label: "Español (España)" },
  { code: "en_US", label: "Inglés (EE. UU.)" },
  { code: "pt_BR", label: "Portugués (Brasil)" },
];

export type NameIssue = "empty" | "too_long" | "invalid_chars";

/** Mirrors the contract: 1-512 chars, lowercase letters, digits and underscores. */
export function validateTemplateName(name: string): NameIssue | null {
  if (name.length === 0) return "empty";
  if (name.length > 512) return "too_long";
  return /^[a-z0-9_]+$/.test(name) ? null : "invalid_chars";
}

/** Turns free text into a valid Meta template name (accent-free, lowercase, underscores). */
export function normalizeTemplateName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export const NAME_MESSAGES: Record<NameIssue, string> = {
  empty: "Escribe un nombre.",
  too_long: "El nombre es demasiado largo.",
  invalid_chars: "Usa solo minúsculas, números y guiones bajos (sin espacios ni acentos).",
};

const VAR_RE = /\{\{\s*(\d+)\s*\}\}/g;

/** Unique, ascending `{{n}}` indexes used by a body. */
export function extractVariables(body: string): number[] {
  const found = new Set<number>();
  for (const m of body.matchAll(VAR_RE)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

export type VariableIssue = "not_sequential" | "edge_variable";

/** Meta rules the contract does not enforce: indexes 1..n without gaps; no variable at the very start/end. */
export function variableIssue(body: string): VariableIssue | null {
  const vars = extractVariables(body);
  if (vars.some((v, i) => v !== i + 1)) return "not_sequential";
  const t = body.trim();
  if (/^\{\{\s*\d+\s*\}\}/.test(t) || /\{\{\s*\d+\s*\}\}$/.test(t)) return "edge_variable";
  return null;
}

/** Replaces `{{n}}` with the sample for that position; blank or missing samples keep the placeholder. */
export function renderPreview(body: string, samples: readonly string[]): string {
  return body.replace(VAR_RE, (match, n: string) => {
    const s = samples[Number(n) - 1];
    return s !== undefined && s.trim() !== "" ? s.trim() : match;
  });
}

export function hasOptOutLine(body: string): boolean {
  return /\bbaja\b/i.test(body);
}

export interface TemplateDraft {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  /** Sample value of each variable, by position (index 0 = `{{1}}`). */
  samples: readonly string[];
}

export type DraftField = "name" | "language" | "body" | "samples";

export interface DraftValidation {
  errors: Partial<Record<DraftField, string>>;
  request: SubmitTemplateRequest | null;
}

/** Validates the form like the API does (same zod schema) plus the Meta variable rules; builds the request. */
export function validateTemplateDraft(draft: TemplateDraft): DraftValidation {
  const errors: DraftValidation["errors"] = {};
  const nameIssue = validateTemplateName(draft.name.trim());
  if (nameIssue) errors.name = NAME_MESSAGES[nameIssue];
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(draft.language.trim())) errors.language = "Código de idioma no válido (ej. es, es_AR).";
  if (draft.body.trim().length === 0) errors.body = "Escribe el texto del mensaje.";
  else if (draft.body.trim().length > 1024) errors.body = "El texto supera los 1024 caracteres.";
  else {
    const vi = variableIssue(draft.body);
    if (vi === "not_sequential") errors.body = "Las variables deben ser {{1}}, {{2}}… sin saltos.";
    if (vi === "edge_variable") errors.body = "El texto no puede empezar ni terminar con una variable.";
  }
  const vars = extractVariables(draft.body);
  if (vars.length > 0 && !errors.body) {
    const missing = vars.some((n) => (draft.samples[n - 1] ?? "").trim() === "");
    if (missing) errors.samples = "Completa un ejemplo para cada variable.";
  }
  if (Object.keys(errors).length > 0) return { errors, request: null };

  const candidate = {
    name: draft.name.trim(),
    language: draft.language.trim(),
    category: draft.category,
    body: draft.body.trim(),
    ...(vars.length > 0 ? { example: renderPreview(draft.body.trim(), draft.samples) } : {}),
  };
  const parsed = submitTemplateRequestSchema.safeParse(candidate);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "name" || key === "language" || key === "body") errors[key] ??= "Valor no válido.";
      else errors.samples ??= "Ejemplo no válido.";
    }
    return { errors, request: null };
  }
  return { errors, request: parsed.data };
}
