import { type Database, type Transaction, withTenant } from "@crmwsp/db";

/**
 * Tenant-bound data access for a request. Created by TenantGuard after the
 * membership check, so controllers never touch the database without tenant.
 */
export class TenantDb {
  constructor(
    private readonly db: Database,
    readonly tenantId: string,
    readonly userId: string,
  ) {}

  run<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return withTenant(this.db, this.tenantId, fn, { userId: this.userId });
  }
}
