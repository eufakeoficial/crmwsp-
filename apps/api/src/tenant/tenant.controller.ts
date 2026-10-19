import { Controller, Get, UseGuards } from "@nestjs/common";
import type { TenantMembersResponse } from "@crmwsp/contracts";
import { asc, eq, memberships, users } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { TenantDb } from "../db/tenant-db.js";

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
}
