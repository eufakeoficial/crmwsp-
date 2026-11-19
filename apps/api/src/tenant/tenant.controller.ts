import { Body, Controller, Get, Patch, Req, UseGuards } from "@nestjs/common";
import { updateTenantRequestSchema, type TenantMembersResponse, type TenantProfile } from "@crmwsp/contracts";
import { asc, eq, memberships, tenants, users } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

@Controller("tenant")
// SessionGuard is global (APP_GUARD) and runs first.
@UseGuards(TenantGuard)
export class TenantController {
  /** Members of the current tenant. Runs under RLS with the app role. */
  @Get("members")
  @Roles("owner", "admin")
  async members(@CurrentTenantDb() db: TenantDb): Promise<TenantMembersResponse> {
    const items = await db.run((tx) =>
      tx
        .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .orderBy(asc(memberships.createdAt), asc(users.id)),
    );
    return { items };
  }

  /** Renames the company. Owner/admin only; the slug is immutable. RLS (tenant_isolation_update) scopes the row. */
  @Patch()
  @Roles("owner", "admin")
  async rename(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<TenantProfile> {
    const input = parseOrThrow(updateTenantRequestSchema, body);
    return db.run(async (tx) => {
      const [before] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, db.tenantId));
      const [row] = await tx
        .update(tenants)
        .set({ name: input.name, updatedAt: new Date() })
        .where(eq(tenants.id, db.tenantId))
        .returning({ id: tenants.id, name: tenants.name });
      if (!row) throw new Error("Tenant row not updated");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: row.id,
        action: "tenant.renamed",
        diff: { from: before?.name ?? null, to: row.name },
        ip: req.ip,
      });
      return row;
    });
  }
}
