import { Body, Controller, Get, NotFoundException, Patch, Req, UseGuards } from "@nestjs/common";
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

  /** Current company profile (name + time zone). Any member may read it. */
  @Get()
  async profile(@CurrentTenantDb() db: TenantDb): Promise<TenantProfile> {
    const [row] = await db.run((tx) =>
      tx.select({ id: tenants.id, name: tenants.name, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, db.tenantId)),
    );
    if (!row) throw new NotFoundException();
    return row;
  }

  /**
   * Updates company name and/or time zone. Owner/admin only; the slug is immutable. RLS
   * (tenant_isolation_update) scopes rows, not columns, so the SET list is an explicit whitelist.
   */
  @Patch()
  @Roles("owner", "admin")
  async update(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<TenantProfile> {
    const input = parseOrThrow(updateTenantRequestSchema, body);
    return db.run(async (tx) => {
      const [before] = await tx.select({ name: tenants.name, timezone: tenants.timezone }).from(tenants).where(eq(tenants.id, db.tenantId));
      const set: { name?: string; timezone?: string; updatedAt: Date } = { updatedAt: new Date() };
      if (input.name !== undefined) set.name = input.name;
      if (input.timezone !== undefined) set.timezone = input.timezone;
      const [row] = await tx
        .update(tenants)
        .set(set)
        .where(eq(tenants.id, db.tenantId))
        .returning({ id: tenants.id, name: tenants.name, timezone: tenants.timezone });
      if (!row) throw new Error("Tenant row not updated");
      const changes: Record<string, { from: string | null; to: string }> = {};
      if (input.name !== undefined) changes["name"] = { from: before?.name ?? null, to: row.name };
      if (input.timezone !== undefined) changes["timezone"] = { from: before?.timezone ?? null, to: row.timezone };
      const nameOnly = input.timezone === undefined;
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: row.id,
        action: nameOnly ? "tenant.renamed" : "tenant.updated",
        // Name-only keeps the legacy flat diff shape.
        diff: nameOnly ? changes["name"]! : changes,
        ip: req.ip,
      });
      return row;
    });
  }
}
