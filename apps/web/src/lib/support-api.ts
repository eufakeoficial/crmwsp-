import {
  SUPPORT_CANNED_VARIABLES,
  type SupportCannedVariable,
  type CreateSupportTicketRequest,
  type PlatformSupportListQuery,
  type PlatformSupportReplyRequest,
  type PlatformSupportUpdateRequest,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
  type UpsertSupportCannedResponseRequest,
  platformSupportThreadSchema,
  platformSupportTicketListSchema,
  platformSupportTicketSchema,
  supportCannedResponseListSchema,
  supportCannedResponseSchema,
  supportTicketListSchema,
  supportTicketSchema,
  supportTicketThreadSchema,
  supportUnreadSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Window event fired when a `support.ticket_updated` SSE event arrives (detail: ticketId). */
export const SUPPORT_CHANGED = "crmwsp:support-changed";
/** Window event fired by the Soporte page after opening a thread (refreshes the badge). */
export const SUPPORT_READ = "crmwsp:support-read";

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Abierto",
  in_progress: "En curso",
  waiting_customer: "Esperando cliente",
  resolved: "Resuelto",
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportTicketCategory, string> = {
  billing: "Facturación",
  whatsapp: "WhatsApp",
  ai: "IA",
  bug: "Error",
  other: "Otro",
};

export const SUPPORT_PRIORITY_LABELS: Record<SupportTicketPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

const KNOWN_VARS = new Set<string>(SUPPORT_CANNED_VARIABLES);

/**
 * Mirror of `renderCannedResponse` in @crmwsp/domain (the web does not depend on it): expands
 * {{nombre}}, {{negocio}}, {{ticket}} and {{asunto}} in one pass; unknown variables stay as written.
 */
export function renderCannedResponse(template: string, vars: Partial<Record<SupportCannedVariable, string>>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (match, name: string) => {
    const key = name.toLowerCase();
    return KNOWN_VARS.has(key) ? (vars[key as SupportCannedVariable] ?? "") : match;
  });
}

const enc = encodeURIComponent;

/** Tenant side (/support). */
export const supportApi = {
  list: (status?: SupportTicketStatus) => request("/support/tickets", { query: { status }, schema: supportTicketListSchema }),
  unreadCount: () => request("/support/unread-count", { schema: supportUnreadSchema }),
  create: (body: CreateSupportTicketRequest) => request("/support/tickets", { method: "POST", body, schema: supportTicketThreadSchema }),
  thread: (id: string) => request(`/support/tickets/${enc(id)}`, { schema: supportTicketThreadSchema }),
  reply: (id: string, body: string) => request(`/support/tickets/${enc(id)}/messages`, { method: "POST", body: { body }, schema: supportTicketThreadSchema }),
  close: (id: string) => request(`/support/tickets/${enc(id)}/close`, { method: "POST", schema: supportTicketSchema }),
};

/** Backoffice side (/platform/support); non-admins get 404. */
export const platformSupportApi = {
  list: (q: PlatformSupportListQuery = {}) =>
    request("/platform/support/tickets", {
      query: { status: q.status, priority: q.priority, category: q.category, tenantId: q.tenantId, assigned: q.assigned },
      schema: platformSupportTicketListSchema,
    }),
  unreadCount: () => request("/platform/support/unread-count", { schema: supportUnreadSchema }),
  thread: (id: string) => request(`/platform/support/tickets/${enc(id)}`, { schema: platformSupportThreadSchema }),
  reply: (id: string, body: PlatformSupportReplyRequest) =>
    request(`/platform/support/tickets/${enc(id)}/messages`, { method: "POST", body, schema: platformSupportThreadSchema }),
  update: (id: string, body: PlatformSupportUpdateRequest) =>
    request(`/platform/support/tickets/${enc(id)}`, { method: "PATCH", body, schema: platformSupportTicketSchema }),
  canned: () => request("/platform/support/canned", { schema: supportCannedResponseListSchema }),
  createCanned: (body: UpsertSupportCannedResponseRequest) =>
    request("/platform/support/canned", { method: "POST", body, schema: supportCannedResponseSchema }),
  updateCanned: (id: string, body: UpsertSupportCannedResponseRequest) =>
    request(`/platform/support/canned/${enc(id)}`, { method: "PUT", body, schema: supportCannedResponseSchema }),
  deleteCanned: (id: string) => request(`/platform/support/canned/${enc(id)}`, { method: "DELETE" }),
};
