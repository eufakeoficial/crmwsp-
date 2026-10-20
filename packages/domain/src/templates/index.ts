import { countTemplatePlaceholders } from "../broadcasts/index.js";

/** Max length of one template parameter (WhatsApp body params are short free text). */
export const MAX_TEMPLATE_PARAM_LENGTH = 1024;

export type TemplateParamsIssue = "count_mismatch" | "empty_param" | "param_too_long";

/** Validates positional params for a template body: exactly one non-blank value per `{{n}}`. */
export function validateTemplateParams(body: string, params: readonly string[]): TemplateParamsIssue | null {
  if (params.length !== countTemplatePlaceholders(body)) return "count_mismatch";
  for (const p of params) {
    if (p.trim().length === 0) return "empty_param";
    if (p.length > MAX_TEMPLATE_PARAM_LENGTH) return "param_too_long";
  }
  return null;
}

/** Renders `{{n}}` placeholders with 1-based params; unknown indexes are left as-is. */
export function renderTemplateBody(body: string, params: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, n: string) => params[Number(n) - 1] ?? match);
}
