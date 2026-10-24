import {
  type PlatformSupportUpdateRequest,
  type SupportEmailComposeRequest,
  type SupportEmailFolder,
  supportEmailThreadListSchema,
  supportEmailThreadSchema,
  supportEmailUnreadSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

const enc = encodeURIComponent;

export const EMAIL_FOLDER_LABELS: Record<SupportEmailFolder, string> = {
  inbox: "Bandeja de entrada",
  mine: "Asignados a mí",
  resolved: "Resueltos",
  sent: "Enviados",
};

/** Window event fired by the Correo page after opening a thread (refreshes the badge). */
export const EMAIL_READ = "crmwsp:email-read";

/** Backoffice email inbox (/platform/support/email, ADR 0020); non-admins get 404. */
export const platformEmailApi = {
  list: (folder: SupportEmailFolder) => request("/platform/support/email/threads", { query: { folder }, schema: supportEmailThreadListSchema }),
  unreadCount: () => request("/platform/support/email/unread-count", { schema: supportEmailUnreadSchema }),
  thread: (id: string) => request(`/platform/support/email/threads/${enc(id)}`, { schema: supportEmailThreadSchema }),
  reply: (id: string, body: string) =>
    request(`/platform/support/email/threads/${enc(id)}/reply`, { method: "POST", body: { body }, schema: supportEmailThreadSchema }),
  update: (id: string, body: PlatformSupportUpdateRequest) =>
    request(`/platform/support/email/threads/${enc(id)}`, { method: "PATCH", body, schema: supportEmailThreadSchema }),
  compose: (body: SupportEmailComposeRequest) => request("/platform/support/email/compose", { method: "POST", body, schema: supportEmailThreadSchema }),
  /** Same-origin, authenticated download through the API proxy (never a provider URL). */
  attachmentUrl: (threadId: string, attachmentId: string) => `/api/platform/support/email/threads/${enc(threadId)}/attachments/${enc(attachmentId)}`,
};

/**
 * srcdoc for the sandboxed iframe that renders received HTML. The sandbox has no allow-* flags
 * (no scripts, no same-origin, no forms, no top navigation) and the CSP blocks every remote
 * load, so tracking pixels and remote CSS never fire even if sanitization missed something.
 */
export function emailSrcDoc(html: string): string {
  const csp = "default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font-family:Arial,sans-serif;font-size:14px;color:#111;margin:8px;word-wrap:break-word}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}
