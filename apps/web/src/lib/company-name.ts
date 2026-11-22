import { tenantNameSchema } from "@crmwsp/contracts";

/** Spanish validation message for the company name, or null when it is valid and changed. */
export function companyNameIssue(raw: string): string | null {
  const r = tenantNameSchema.safeParse(raw);
  if (r.success) return null;
  const trimmed = raw.trim();
  return trimmed.length < 2 ? "El nombre debe tener al menos 2 caracteres." : "El nombre no puede superar los 80 caracteres.";
}

/** True when the trimmed draft differs from the saved name. */
export function companyNameChanged(draft: string, saved: string): boolean {
  return draft.trim() !== saved;
}
