/**
 * Read-only client for Resend's Receiving API (ADR 0020). Uses RESEND_API_KEY; only GET calls.
 * Docs: https://resend.com/docs/api-reference/emails/retrieve-received-email
 *       https://resend.com/docs/api-reference/emails/retrieve-received-email-attachment
 * Errors never include the key or response bodies.
 */

export interface ResendReceivedAttachment {
  id: string;
  filename: string;
  contentType: string;
  size: number | null;
}

export interface ResendReceivedEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  headers: unknown;
  messageId: string | null;
  attachments: ResendReceivedAttachment[];
}

export class ResendApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ResendApiError";
  }
}

export type ResendFetch = (url: string, init: { method: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const API = "https://api.resend.com";
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : typeof v === "string" ? [v] : []);

function toAttachment(a: unknown): ResendReceivedAttachment | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  const id = str(o.id);
  if (!id) return null;
  return {
    id,
    filename: (str(o.filename) ?? "adjunto").slice(0, 255),
    contentType: (str(o.content_type) ?? "application/octet-stream").slice(0, 120),
    size: typeof o.size === "number" && Number.isFinite(o.size) ? o.size : null,
  };
}

export function parseResendReceivedEmail(body: unknown): ResendReceivedEmail {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = str(o.id);
  if (!id) throw new ResendApiError("received email without id", null);
  return {
    id,
    from: str(o.from) ?? "",
    to: strArr(o.to),
    subject: str(o.subject) ?? "",
    html: str(o.html),
    text: str(o.text),
    headers: o.headers ?? null,
    messageId: str(o.message_id),
    attachments: (Array.isArray(o.attachments) ? o.attachments : []).map(toAttachment).filter((x): x is ResendReceivedAttachment => x !== null),
  };
}

export class ResendReceivingClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: ResendFetch = globalThis.fetch as unknown as ResendFetch,
    private readonly timeoutMs = 10_000,
  ) {}

  private async get(path: string): Promise<unknown> {
    const res = await this.fetchImpl(`${API}${path}`, {
      method: "GET",
      headers: { authorization: `Bearer ${this.apiKey}`, accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new ResendApiError(`resend GET failed (${res.status})`, res.status);
    return res.json();
  }

  async getReceivedEmail(emailId: string): Promise<ResendReceivedEmail> {
    if (!ID_RE.test(emailId)) throw new ResendApiError("invalid email id", null);
    return parseResendReceivedEmail(await this.get(`/emails/receiving/${encodeURIComponent(emailId)}`));
  }

  /** Short-lived download URL of one attachment (valid ~1 hour per Resend docs). */
  async getAttachmentDownloadUrl(emailId: string, attachmentId: string): Promise<{ url: string; filename: string; contentType: string }> {
    if (!ID_RE.test(emailId) || !ID_RE.test(attachmentId)) throw new ResendApiError("invalid id", null);
    const o = (await this.get(`/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`)) as Record<string, unknown>;
    const url = str(o?.download_url);
    if (!url || !/^https:\/\//i.test(url)) throw new ResendApiError("attachment without download url", null);
    return { url, filename: (str(o.filename) ?? "adjunto").slice(0, 255), contentType: (str(o.content_type) ?? "application/octet-stream").slice(0, 120) };
  }
}

/** Null when RESEND_API_KEY is unset (inbound bodies cannot be fetched; webhook still stored). */
export function resendReceivingFromEnv(env: Record<string, string | undefined> = process.env): ResendReceivingClient | null {
  const key = env.RESEND_API_KEY?.trim();
  return key ? new ResendReceivingClient(key) : null;
}

/** Sender used for platform inbox replies (ADR 0020). */
export const PLATFORM_INBOX_FROM = "Vende+ WSP <contacto@vendemas.chat>";
export const PLATFORM_INBOX_ADDRESS = "contacto@vendemas.chat";
