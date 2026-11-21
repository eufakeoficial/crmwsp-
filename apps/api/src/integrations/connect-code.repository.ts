import { sql, type Database, type Transaction } from "@crmwsp/db";

export interface ConsumedConnectCode {
  tenantId: string;
  /** Owner/admin who issued the code (audit actor of the resulting connection). */
  userId: string;
  tenantName: string;
}

/** Port over the SECURITY DEFINER functions of 0096 (`connect_code_issue` / `connect_code_consume`). */
export interface ConnectCodeRepository {
  /** Must run inside the tenant's transaction (the function checks app.tenant_id). Null: not issued. */
  issue(tx: Transaction, tenantId: string, userId: string, codeHash: Buffer, ttlSeconds: number): Promise<Date | null>;
  /**
   * Consumes the code and, if valid, runs `fn` in the SAME transaction scoped to the code's tenant:
   * a failure in `fn` rolls the consumption back. Null (and `fn` not run) for an invalid code.
   */
  consumeInTenant<T>(codeHash: Buffer, fn: (code: ConsumedConnectCode, tx: Transaction) => Promise<T>): Promise<T | null>;
}

export const CONNECT_CODE_REPOSITORY = Symbol("CONNECT_CODE_REPOSITORY");

export class PgConnectCodeRepository implements ConnectCodeRepository {
  constructor(private readonly db: Database) {}

  async issue(tx: Transaction, tenantId: string, userId: string, codeHash: Buffer, ttlSeconds: number): Promise<Date | null> {
    const rows = await tx.execute<{ expires_at: Date | string }>(
      sql`select expires_at from public.connect_code_issue(${tenantId}::uuid, ${userId}::uuid, ${codeHash}, ${ttlSeconds})`,
    );
    const r = rows[0];
    return r ? new Date(r.expires_at) : null;
  }

  consumeInTenant<T>(codeHash: Buffer, fn: (code: ConsumedConnectCode, tx: Transaction) => Promise<T>): Promise<T | null> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ tenant_id: string; created_by: string; tenant_name: string }>(
        sql`select tenant_id, created_by, tenant_name from public.connect_code_consume(${codeHash})`,
      );
      const r = rows[0];
      // Commits the burn of a code that failed the tenant/issuer checks: it is never retried.
      if (!r) return null;
      // Same transaction-local context as withTenant (RLS for the writes below).
      await tx.execute(sql`select set_config('app.tenant_id', ${r.tenant_id}, true)`);
      await tx.execute(sql`select set_config('app.user_id', ${r.created_by}, true)`);
      return fn({ tenantId: r.tenant_id, userId: r.created_by, tenantName: r.tenant_name }, tx);
    });
  }
}
