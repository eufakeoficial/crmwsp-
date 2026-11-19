/** Pure helpers of the global search palette: remote-query rules and deep links. */

export const REMOTE_MIN_CHARS = 2;
export const REMOTE_MAX_CHARS = 100;
export const REMOTE_LIMIT = 8;
export const REMOTE_DEBOUNCE_MS = 250;

/** Trimmed, length-capped query, or null when it is too short to hit the API. */
export function remoteQuery(raw: string): string | null {
  const q = raw.trim().slice(0, REMOTE_MAX_CHARS);
  return q.length >= REMOTE_MIN_CHARS ? q : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opens one conversation in the inbox. */
export const inboxConversationHref = (id: string): string => `/app/inbox?conversation=${encodeURIComponent(id)}`;

/** Opens the inbox with its own search box prefilled and applied. */
export const inboxSearchHref = (q: string): string => `/app/inbox?q=${encodeURIComponent(q.trim().slice(0, REMOTE_MAX_CHARS))}`;

/** Opens the contacts list filtered by the text. */
export const contactsSearchHref = (q: string): string => `/app/contacts?q=${encodeURIComponent(q.trim().slice(0, REMOTE_MAX_CHARS))}`;

/** Reads `?conversation=` (UUID only) and `?q=` (trimmed, capped) from a location search string. */
export function parseInboxDeepLink(search: string): { conversation: string | null; q: string } {
  const params = new URLSearchParams(search);
  const conversation = params.get("conversation");
  return {
    conversation: conversation && UUID.test(conversation) ? conversation : null,
    q: (params.get("q") ?? "").trim().slice(0, REMOTE_MAX_CHARS),
  };
}

/** One-line preview, ellipsized. */
export function snippet(text: string | null | undefined, max = 80): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
