export const SESSION_TTL_SECONDS = Symbol("SESSION_TTL_SECONDS");

/** SESSION_TTL_DAYS (default 30), sliding. Bounded by the DB functions to 90 days. */
export function sessionTtlSecondsFromEnv(): number {
  const raw = process.env["SESSION_TTL_DAYS"];
  const days = raw === undefined || raw === "" ? 30 : Number(raw);
  if (!Number.isFinite(days) || days <= 0 || days > 90) {
    throw new Error("SESSION_TTL_DAYS must be a number in (0, 90]");
  }
  return Math.round(days * 24 * 3600);
}
