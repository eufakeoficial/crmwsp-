/**
 * Signup anti-abuse helpers (ADR 0015, T7). Pure functions; the normalized email is only a
 * multi-account signal, never the login email (existing accounts are unaffected).
 */

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** Lowercase, strip `+tag`; for gmail/googlemail also drop dots (googlemail -> gmail). */
export function normalizeSignupEmail(email: string): string | null {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at <= 0 || at === trimmed.length - 1) return null;
  let local = trimmed.slice(0, at);
  let domain = trimmed.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus >= 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  if (!local) return null;
  return `${local}@${domain}`;
}

/** Small static list of throwaway providers (no dependency); subdomains match too. */
export const DISPOSABLE_EMAIL_DOMAINS: ReadonlySet<string> = new Set([
  "mailinator.com",
  "yopmail.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "temp-mail.org",
  "tempmail.com",
  "tempmailo.com",
  "throwawaymail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "mintemail.com",
  "fakeinbox.com",
  "emailondeck.com",
  "moakt.com",
  "mohmal.com",
  "tmail.ws",
  "tmpmail.org",
  "burnermail.io",
  "spamgourmet.com",
  "mailcatch.com",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  if (!domain) return false;
  for (let d = domain; d.includes("."); d = d.slice(d.indexOf(".") + 1)) {
    if (DISPOSABLE_EMAIL_DOMAINS.has(d)) return true;
  }
  return false;
}
