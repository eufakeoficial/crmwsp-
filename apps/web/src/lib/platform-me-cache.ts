/**
 * Per-user cache for "is this user a platform admin?". Only `true` is cached (admin rights are
 * rarely revoked mid-session and the API still enforces them); `false` and errors are never cached,
 * so a user granted admin after loading the app sees the panel without a full reload.
 */
export function createPlatformMeCache(fetchMe: () => Promise<boolean>) {
  let adminUserId: string | null = null;
  const inflight = new Map<string, Promise<boolean>>();
  return {
    peek(userId: string): boolean | null {
      return adminUserId === userId ? true : null;
    },
    load(userId: string): Promise<boolean> {
      if (adminUserId === userId) return Promise.resolve(true);
      const pending = inflight.get(userId);
      if (pending) return pending;
      const p = fetchMe()
        .then(
          (v) => {
            if (v) adminUserId = userId;
            else if (adminUserId === userId) adminUserId = null;
            return v;
          },
          () => false,
        )
        .finally(() => inflight.delete(userId));
      inflight.set(userId, p);
      return p;
    },
  };
}
