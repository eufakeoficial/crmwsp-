import { z } from "zod";
import { emailSchema, membershipRoleSchema, passwordSchema } from "./auth.js";
import { tenantIdSchema, uuidSchema } from "./common.js";

/** Roles grantable by invitation: never owner. */
export const invitableRoleSchema = z.enum(["admin", "agent", "viewer"]);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

/** Invitation token in the link: 32 random bytes, base64url (43 chars). */
export const invitationTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, "Invalid invitation token");

export const createInvitationRequestSchema = z.object({ email: emailSchema, role: invitableRoleSchema });
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

export const teamInvitationSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  role: invitableRoleSchema,
  invitedBy: z.string().nullable(),
  expiresAt: z.string(),
  lastSentAt: z.string(),
  createdAt: z.string(),
});
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;

export const teamInvitationListSchema = z.object({ items: z.array(teamInvitationSchema) });
export type TeamInvitationList = z.infer<typeof teamInvitationListSchema>;

export const updateMemberRoleRequestSchema = z.object({ role: membershipRoleSchema });
export type UpdateMemberRoleRequest = z.infer<typeof updateMemberRoleRequestSchema>;

/** Public preview of an invitation (minimal: never ids, never the inviter). */
export const invitationPreviewSchema = z.object({
  tenantName: z.string(),
  email: z.string(),
  role: invitableRoleSchema,
  expiresAt: z.string(),
  hasAccount: z.boolean(),
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

/** Accept: signed-in users send nothing; new users send name + password. */
export const acceptInvitationRequestSchema = z.union([
  z.object({ name: z.string().trim().min(1).max(200), password: passwordSchema }),
  z.object({}).strict(),
]);
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const acceptInvitationResponseSchema = z.object({ tenantId: tenantIdSchema, role: invitableRoleSchema });
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
