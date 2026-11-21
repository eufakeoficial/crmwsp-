import { z } from "zod";

/** Company (tenant) display name: trimmed, 2-80 chars. The slug is never editable. */
export const tenantNameSchema = z.string().trim().min(2, "Name is too short").max(80, "Name is too long");

/** True when `zone` is a real IANA time zone known to this runtime. */
export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA time zone (e.g. "America/Lima"), max 64 chars. */
export const tenantTimezoneSchema = z
  .string()
  .trim()
  .min(1, "Timezone is required")
  .max(64, "Timezone is too long")
  .refine(isValidTimeZone, "Unknown IANA time zone");

export const updateTenantRequestSchema = z
  .object({ name: tenantNameSchema.optional(), timezone: tenantTimezoneSchema.optional() })
  .strict()
  .refine((v) => v.name !== undefined || v.timezone !== undefined, "At least one field is required");
export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;

export const tenantProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Missing on older API responses = Europe/Madrid. */
  timezone: z.string().optional(),
});
export type TenantProfile = z.infer<typeof tenantProfileSchema>;
