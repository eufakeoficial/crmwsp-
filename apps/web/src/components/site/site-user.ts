export interface SiteUser {
  name: string | null;
  email: string;
}

/** First word of the display name, falling back to the email local part. */
export function firstName(user: SiteUser): string {
  const fromName = user.name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  return user.email.split("@")[0] ?? user.email;
}

// One /auth/me call per page load, shared by every header consumer.
let pending: Promise<SiteUser | null> | null = null;

export function loadSiteUser(fetchMe: () => Promise<{ user: SiteUser }>): Promise<SiteUser | null> {
  pending ??= fetchMe()
    .then((me) => ({ name: me.user.name ?? null, email: me.user.email }))
    // 401 means logged out; any other failure also keeps the logged-out header (no console noise).
    .catch(() => null);
  return pending;
}

export function resetSiteUser(): void {
  pending = null;
}
