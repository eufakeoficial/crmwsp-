import { z } from "zod";

/** Company (tenant) display name: trimmed, 2-80 chars. The slug is never editable. */
export const tenantNameSchema = z.string().trim().min(2, "Name is too short").max(80, "Name is too long");

export const updateTenantRequestSchema = z.object({ name: tenantNameSchema }).strict();
export type UpdateTenantRequest = z.infer<typeof updateTenantRequestSchema>;

export const tenantProfileSchema = z.object({ id: z.string(), name: z.string() });
export type TenantProfile = z.infer<typeof tenantProfileSchema>;
