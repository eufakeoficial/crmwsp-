import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { salesMetricsQuerySchema, type SalesMetrics } from "@crmwsp/contracts";
import { CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { loadSalesMetrics } from "./metrics.service.js";

@Controller("metrics")
@UseGuards(TenantGuard)
export class MetricsController {
  @Get("sales")
  sales(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<SalesMetrics> {
    const q = parseOrThrow(salesMetricsQuerySchema, query);
    return db.run((tx) => loadSalesMetrics(tx, db.tenantId, q));
  }
}
