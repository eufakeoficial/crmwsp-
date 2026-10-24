/**
 * Pure rules of the platform email inbox (ADR 0020): address parsing, subject normalization,
 * threading keys, auto-generated mail detection and conservative HTML sanitization.
 * No I/O here; the worker and the API compose these.
 */

export interface ParsedAddress {
  email: string;
  name: string | null;
}

const EMAIL_RE = /^[^\s@<>"(),;:]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** True for a plain, sane mailbox (no display name, no header injection characters). */
export function isPlainEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value) && !/[\r\n]/.test(value);
}

/** Parses `Name <a@b.c>` or `a@b.c`. Returns null when no valid address is present. */
export function parseAddress(raw: string | null | undefined): ParsedAddress | null {
  if (!raw) return null;
  const value = raw.replace(/[\r\n]+/g, " ").trim();
  const angle = /<([^<>]+)>\s*$/.exec(value);
  const email = (angle ? angle[1]! : value).trim().toLowerCase();
  if (!isPlainEmail(email)) return null;
  let name: string | null = angle ? value.slice(0, angle.index).trim().replace(/^"(.*)"$/, "$1").trim() : null;
  if (name !== null && name.length === 0) name = null;
  return { email, name: name ? name.slice(0, 120) : null };
}

const REPLY_PREFIX_RE = /^\s*((re|fw|fwd|rv|res|enc|aw|wg|tr)\s*(\[\d+\])?\s*:\s*)+/i;
const TICKET_TOKEN_RE = /\[(?:Ticket\s*)?#(\d{1,9})\]/i;

/** Lower-cased subject without reply/forward prefixes, ticket token or extra whitespace. */
export function normalizeSubject(subject: string | null | undefined): string {
  let s = (subject ?? "").replace(TICKET_TOKEN_RE, " ");
  let prev: string;
  do {
    prev = s;
    s = s.replace(REPLY_PREFIX_RE, "");
  } while (s !== prev);
  return s.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 200);
}

/** Ticket number carried in the subject token (`[Ticket #123]`), if any. */
export function ticketNumberFromSubject(subject: string | null | undefined): number | null {
  const m = TICKET_TOKEN_RE.exec(subject ?? "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Subject of an outbound reply: `Re: <original> [Ticket #n]` (token added once). */
export function replySubject(original: string, ticketNumber: number): string {
  const base = original.replace(TICKET_TOKEN_RE, "").replace(/\s+/g, " ").trim() || "(sin asunto)";
  const withRe = REPLY_PREFIX_RE.test(base) ? base : `Re: ${base}`;
  return `${withRe} [Ticket #${ticketNumber}]`.slice(0, 250);
}

/** Message-ids (`<id@host>`) found in an In-Reply-To / References header value. At most 50. */
export function parseMessageIds(value: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(value) ? value.join(" ") : (value ?? "");
  const out: string[] = [];
  for (const m of raw.matchAll(/<([^<>\s]{1,250})>/g)) {
    const id = `<${m[1]}>`;
    if (!out.includes(id)) out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}

/** Case-insensitive header map from Resend's `headers` (object or `[{name,value}]`). */
export function headerMap(headers: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const put = (k: unknown, v: unknown): void => {
    if (typeof k !== "string") return;
    const value = Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" ") : typeof v === "string" ? v : null;
    if (value !== null) map.set(k.toLowerCase(), value.slice(0, 4000));
  };
  if (Array.isArray(headers)) {
    for (const h of headers) if (h && typeof h === "object") put((h as { name?: unknown }).name, (h as { value?: unknown }).value);
  } else if (headers && typeof headers === "object") {
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) put(k, v);
  }
  return map;
}

export type AutoMailReason = "auto_submitted" | "precedence" | "bounce" | "list" | null;

/**
 * Detects auto-replies, bounces and bulk/list mail (RFC 3834 Auto-Submitted, Precedence,
 * X-Autoreply, empty/MAILER-DAEMON senders). Such mail is stored but never answered and never
 * reopens a ticket automatically; it also never triggers notifications.
 */
export function autoMailReason(headers: Map<string, string>, from: string | null): AutoMailReason {
  const autoSubmitted = headers.get("auto-submitted")?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return "auto_submitted";
  if (headers.has("x-autoreply") || headers.has("x-autorespond")) return "auto_submitted";
  const precedence = headers.get("precedence")?.trim().toLowerCase();
  if (precedence && ["bulk", "junk", "list", "auto_reply"].includes(precedence)) return "precedence";
  const local = (from ?? "").split("@")[0]?.toLowerCase() ?? "";
  if (!from || ["mailer-daemon", "postmaster", "no-reply", "noreply", "do-not-reply", "donotreply"].includes(local)) return "bounce";
  if (headers.get("return-path")?.trim() === "<>") return "bounce";
  if (headers.has("list-id") || headers.has("list-unsubscribe")) return "list";
  return null;
}

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math", "frameset", "frame", "applet", "title", "head"];
const DROP_TAG = ["link", "meta", "base", "form", "input", "button", "textarea", "select", "option", "html", "body", "!doctype"];

function safeUrl(url: string, kind: "href" | "src"): string | null {
  const v = url.replace(/&#(x?)([0-9a-f]+);?/gi, (_, hex: string, n: string) => String.fromCharCode(parseInt(n, hex ? 16 : 10))).split("").filter((c) => c.charCodeAt(0) > 32).join("");
  if (kind === "src") return /^(cid:|data:image\/(png|gif|jpe?g|webp);base64,)/i.test(v) ? url : null;
  return /^(https?:|mailto:)/i.test(v) ? url : null;
}

/**
 * Conservative sanitizer for received HTML. Defense in depth only: the UI also renders it in a
 * sandboxed iframe (no scripts, no same-origin) with a CSP that blocks every remote load.
 * Removes active content, event handlers, `style` url()/expression(), javascript: links and every
 * remote image/resource (tracking pixels). Links keep http(s)/mailto only and get rel=noopener.
 */
export function sanitizeEmailHtml(html: string, maxLength = 500_000): string {
  let s = html.slice(0, maxLength * 2);
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of DROP_WITH_CONTENT) {
    s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi"), "");
    s = s.replace(new RegExp(`<\\/?${tag}\\b[^>]*>`, "gi"), "");
  }
  for (const tag of DROP_TAG) s = s.replace(new RegExp(`<\\/?${tag.replace("!", "!")}\\b[^>]*>`, "gi"), "");
  s = s.replace(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi, (_m, tag: string, attrs: string) => {
    const kept: string[] = [];
    for (const a of attrs.matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      const name = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (name.startsWith("on") || name === "srcset" || name === "formaction" || name === "background" || name === "xmlns" || name.includes(":")) continue;
      if (name === "href") {
        const u = safeUrl(value, "href");
        if (u) kept.push(`href="${u.replace(/"/g, "&quot;")}"`, 'rel="noopener noreferrer nofollow"', 'target="_blank"');
        continue;
      }
      if (name === "src") {
        const u = safeUrl(value, "src");
        if (u) kept.push(`src="${u.replace(/"/g, "&quot;")}"`);
        continue;
      }
      if (name === "style") {
        if (/url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:/i.test(value)) continue;
        kept.push(`style="${value.replace(/"/g, "&quot;")}"`);
        continue;
      }
      if (name === "target" || name === "rel") continue;
      if (["class", "id", "align", "valign", "width", "height", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "color", "bgcolor", "dir", "lang", "alt", "title", "face", "size"].includes(name)) {
        kept.push(`${name}="${value.replace(/"/g, "&quot;")}"`);
      }
    }
    return `<${tag.toLowerCase()}${kept.length ? ` ${kept.join(" ")}` : ""}>`;
  });
  return s.slice(0, maxLength);
}

/** Plain-text fallback from HTML (for snippets/body when the mail has no text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** References header for an outbound reply: previous chain + the message replied to (max 20). */
export function buildReferences(previous: string[], inReplyTo: string | null): string[] {
  const all = [...previous];
  if (inReplyTo && !all.includes(inReplyTo)) all.push(inReplyTo);
  return all.slice(-20);
}

/** Max inbound emails accepted per sender per hour before the rest are dropped as abuse. */
export const EMAIL_SENDER_HOURLY_LIMIT = 20;
/** Max outbound emails per platform admin per hour (new compose + replies). */
export const EMAIL_OUTBOUND_HOURLY_LIMIT = 60;
/** Inbound bodies above this are truncated (text) or dropped (html). */
export const EMAIL_TEXT_MAX = 200_000;
export const EMAIL_HTML_MAX = 500_000;
/** Same sender + same normalized subject within this window joins the open thread. */
export const EMAIL_THREAD_WINDOW_DAYS = 30;
