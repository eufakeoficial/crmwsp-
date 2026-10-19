import { sql } from "drizzle-orm";
import type { Database, Transaction } from "./client";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Runs `fn` inside a transaction scoped to `tenantId`. The tenant is set with
 * `set_config('app.tenant_id', $1, true)` (transaction-local), so RLS policies
 * only expose rows of that tenant and the setting never leaks to the pool.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new TypeError("withTenant: tenantId must be a valid uuid");
  }
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs `fn` in a transaction WITHOUT a tenant context.
 *
 * Only for system jobs (migrations, provisioning, cross-tenant maintenance)
 * running with a role allowed to see all rows. With the app role, RLS will
 * return no rows. Never use it from request handlers.
 *
 * @internal
 */
export async function dangerouslyWithoutTenant<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
