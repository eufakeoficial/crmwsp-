import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { profitabilityQuerySchema, type Profitability } from "@crmwsp/contracts";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { loadProfitability } from "./profitability.service.js";

@Controller("analytics")
@UseGuards(TenantGuard)
export class AnalyticsController {
  /** Profitability per customer, order or ad: verified revenue vs attributable (partly estimated) costs. */
  @Get("profitability")
  @Roles("owner", "admin")
  profitability(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<Profitability> {
    const q = parseOrThrow(profitabilityQuerySchema, query);
    return db.run((tx) => loadProfitability(tx, db.tenantId, q));
  }
}
