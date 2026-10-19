import { auditEvents, type Transaction } from "@crmwsp/db";

export interface AuditEntry {
  tenantId: string;
  userId: string;
  entity: string;
  entityId: string;
  action: string;
  diff?: Record<string, unknown>;
  ip?: string | undefined;
}

/** Appends an audit row inside the caller's tenant transaction. Never put secrets in `diff`. */
export async function writeAudit(tx: Transaction, e: AuditEntry): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: e.tenantId,
    actorType: "user",
    actorId: e.userId,
    entity: e.entity,
    entityId: e.entityId,
    action: e.action,
    diff: e.diff ?? {},
    ip: e.ip && e.ip.length > 0 ? e.ip : null,
  });
}

/** Postgres error code from a drizzle/postgres.js error (never the message: it embeds params). */
export function pgCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | undefined;
  const code = e?.cause?.code ?? e?.code;
  return typeof code === "string" ? code : undefined;
}

export const PG_UNIQUE_VIOLATION = "23505";
