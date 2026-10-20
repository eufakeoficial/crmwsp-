import { ConflictError, ValidationError } from "@crmwsp/contracts";
import { eq, memberships, type Transaction } from "@crmwsp/db";

/** bigint column -> JSON number. Values are bounded by the contracts, so this never loses precision. */
export function toNum(v: bigint | number | string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) throw new RangeError("amount exceeds the safe integer range");
  return n;
}

export const toNumReq = (v: bigint | number | string): number => toNum(v) as number;

export function iso(v: Date | string | null): string | null {
  return v === null ? null : new Date(v).toISOString();
}

/** Escapes LIKE wildcards so user input matches literally. */
export const likeEscape = (s: string): string => s.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** memberships is tenant-scoped by RLS: users of other tenants are never found. */
export async function assertMember(tx: Transaction, userId: string, what = "Assignee"): Promise<void> {
  const [m] = await tx.select({ id: memberships.id }).from(memberships).where(eq(memberships.userId, userId));
  if (!m) throw new ValidationError(`${what} is not a member of this tenant`);
}

export const modified = (what: string): ConflictError => new ConflictError(`${what} was modified; reload and retry`);

/** Extracts the cause message of a driver error without ever echoing bind parameters. */
export function pgMessage(err: unknown): string | undefined {
  const e = err as { cause?: { message?: unknown }; message?: unknown } | undefined;
  const m = e?.cause?.message ?? undefined;
  return typeof m === "string" ? m : undefined;
}
