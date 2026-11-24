import { Controller, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { listUnansweredQuotesQuerySchema, type UnansweredQuoteListResponse, type UnansweredQuoteReview } from "@crmwsp/contracts";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { ActivationGuard } from "../billing/activation.guard.js";
import { type HttpRequest, type RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { listUnansweredQuotes, reviewUnansweredQuote } from "./unanswered-quotes.service.js";

@Controller("quotes/unanswered")
@UseGuards(TenantGuard, ActivationGuard)
export class UnansweredQuotesController {
  @Get()
  list(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant, @Query() query: unknown): Promise<UnansweredQuoteListResponse> {
    const q = parseOrThrow(listUnansweredQuotesQuerySchema, query);
    return db.run((tx) => listUnansweredQuotes(tx, { tenantId: db.tenantId, role: tenant.role, userId: db.userId }, q));
  }

  @Post(":quoteId/review")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  review(
    @CurrentTenantDb() db: TenantDb,
    @CurrentTenant() tenant: RequestTenant,
    @Param("quoteId") quoteId: string,
    @Req() req: HttpRequest,
  ): Promise<UnansweredQuoteReview> {
    return db.run((tx) => reviewUnansweredQuote(tx, { tenantId: db.tenantId, role: tenant.role, userId: db.userId }, quoteId, req.ip));
  }
}
