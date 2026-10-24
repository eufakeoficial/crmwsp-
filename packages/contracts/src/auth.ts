import { z } from "zod";
import { tenantIdSchema, uuidSchema } from "./common.js";

export const membershipRoleSchema = z.enum(["owner", "admin", "agent", "viewer"]);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

/** Login identity: trimmed and lower-cased before validation. */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));

/** Min 10 chars; max bounds the hashing cost (DoS). */
export const passwordSchema = z.string().min(10).max(256);

/** Tenant slug: 3-63 chars, lowercase letters, digits and inner hyphens. */
export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, "Invalid tenant slug"));

export const signupRequestSchema = z.object({
  email: emailSchema,
  name: z.string().trim().min(1).max(200),
  password: passwordSchema,
  tenantName: z.string().trim().min(1).max(200),
  tenantSlug: tenantSlugSchema,
  /** Referral code from `/signup?ref=CODE` (ADR 0017); unknown codes are ignored. */
  referralCode: z.string().trim().max(32).regex(/^[A-Za-z0-9]*$/).optional(),
});
export type SignupRequest = z.infer<typeof signupRequestSchema>;

export const loginRequestSchema = z.object({
  email: emailSchema,
  // No min length on login: any wrong password gets the same generic 401.
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/** POST /auth/password/forgot: always answers 200, whether the account exists or not. */
export const forgotPasswordRequestSchema = z.object({ email: emailSchema });
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

/** POST /auth/password/reset: single-use 43-char base64url token from the email link. */
export const resetPasswordRequestSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid token"),
  password: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

/** Tenant lifecycle (ADR 0011): only `active` tenants can use the panel, channels and AI. */
export const tenantStatusSchema = z.enum(["active", "pending_approval", "rejected", "suspended"]);
export type TenantStatus = z.infer<typeof tenantStatusSchema>;

export const userTenantSchema = z.object({
  id: tenantIdSchema,
  slug: z.string(),
  name: z.string(),
  role: membershipRoleSchema,
  /** Missing on older API responses = active. */
  status: tenantStatusSchema.optional(),
});
export type UserTenant = z.infer<typeof userTenantSchema>;

export const meResponseSchema = z.object({
  user: z.object({ id: uuidSchema, email: z.string(), name: z.string().nullable() }),
  tenants: z.array(userTenantSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const tenantMemberSchema = z.object({
  userId: uuidSchema,
  email: z.string(),
  name: z.string().nullable(),
  role: membershipRoleSchema,
});
export type TenantMember = z.infer<typeof tenantMemberSchema>;

export const tenantMembersResponseSchema = z.object({ items: z.array(tenantMemberSchema) });
export type TenantMembersResponse = z.infer<typeof tenantMembersResponseSchema>;

/** Header carrying the active tenant on tenant-scoped requests. */
export const TENANT_HEADER = "x-tenant-id";
