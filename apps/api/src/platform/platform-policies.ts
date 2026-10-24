import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  businessCategoryKeySchema,
  categoryReviewDecisionRequestSchema,
  platformCategoryReviewQuerySchema,
  platformQualityAlertQuerySchema,
  type PlatformQualityAlert,
  type PlatformQualityAlertList,
  upsertBusinessCategoryRequestSchema,
  uuidSchema,
  type PlatformBusinessCategoryList,
  type PlatformCategoryReview,
  type PlatformCategoryReviewList,
} from "@crmwsp/contracts";
import { CurrentUser } from "../auth/decorators.js";
import { DB_HANDLE, type DbHandle, type HttpRequest, type RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { pgCode } from "../inbox/audit.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";

const iso = (v: Date | string | null): string | null => (v === null ? null : new Date(v).toISOString());

/** Maps platform_* SQL errors: non-admin → 404 (ADR 0011), bad input → 400, missing → 404, state → 409. */
export function mapPlatformError(err: unknown): never {
  switch (pgCode(err)) {
    case "42501":
    case "P0002":
      throw new NotFoundError();
    case "22023":
      throw new ValidationError();
    case "55000":
      throw new ConflictError();
    default:
      throw err;
  }
}

/** Policy backoffice (ADR 0021): business category rules and their review queue. */
@Injectable()
export class PlatformPoliciesService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async categories(actor: string): Promise<PlatformBusinessCategoryList> {
    type Row = { key: string; label: string; action: "block" | "review" | "warn" | "allow"; guidance: string | null; sort_order: number; active: boolean; updated_at: Date; tenant_count: number };
    const rows = await this.handle.sql<Row[]>`select * from public.platform_business_category_list(${actor})`.catch(mapPlatformError);
    return {
      items: rows.map((r) => ({
        key: r.key,
        label: r.label,
        action: r.action,
        guidance: r.guidance,
        sortOrder: r.sort_order,
        active: r.active,
        updatedAt: new Date(r.updated_at).toISOString(),
        tenantCount: Number(r.tenant_count),
      })),
    };
  }

  async upsertCategory(actor: string, ip: string | null, key: string, body: unknown): Promise<void> {
    const k = parseOrThrow(businessCategoryKeySchema, key);
    const input = parseOrThrow(upsertBusinessCategoryRequestSchema, body);
    await this.handle.sql`select public.platform_business_category_upsert(
      ${actor}, ${k}, ${input.label}, ${input.action}, ${input.guidance ?? null}, ${input.sortOrder ?? null}, ${input.active ?? null}, ${ip}::inet)`.catch(
      mapPlatformError,
    );
  }

  async reviews(actor: string, status: string | undefined): Promise<PlatformCategoryReviewList> {
    type Row = {
      tenant_id: string; name: string; slug: string; tenant_status: string; category: string | null; category_label: string | null;
      category_action: PlatformCategoryReview["categoryAction"]; detail: string | null; review_status: PlatformCategoryReview["reviewStatus"];
      review_reason: string | null; set_at: Date | null; owner_email: string | null;
    };
    const rows = await this.handle.sql<Row[]>`select * from public.platform_category_review_list(${actor}, ${status ?? null})`.catch(mapPlatformError);
    return {
      items: rows.map((r) => ({
        tenantId: r.tenant_id,
        name: r.name,
        slug: r.slug,
        tenantStatus: r.tenant_status,
        category: r.category,
        categoryLabel: r.category_label,
        categoryAction: r.category_action,
        detail: r.detail,
        reviewStatus: r.review_status,
        reviewReason: r.review_reason,
        setAt: iso(r.set_at),
        ownerEmail: r.owner_email,
      })),
    };
  }

  async qualityAlerts(actor: string, days: number | undefined): Promise<PlatformQualityAlertList> {
    type Row = {
      event_id: string; tenant_id: string; tenant_name: string; channel_id: string; provider: string; phone_last4: string; field: string;
      event: string | null; quality: string | null; reason: string | null; severity: PlatformQualityAlert["severity"]; account_status: string; created_at: Date;
    };
    const rows = await this.handle.sql<Row[]>`select * from public.platform_channel_quality_alerts(${actor}, ${days ?? 30})`.catch(mapPlatformError);
    return {
      items: rows.map((r) => ({
        eventId: r.event_id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        channelId: r.channel_id,
        provider: r.provider,
        phoneLast4: r.phone_last4,
        field: r.field,
        event: r.event,
        quality: r.quality,
        reason: r.reason,
        severity: r.severity,
        accountStatus: r.account_status,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }

  async decide(actor: string, ip: string | null, tenantId: string, approve: boolean, reason: string | undefined): Promise<{ reviewStatus: string }> {
    const rows = await this.handle.sql<{ status: string }[]>`
      select public.platform_category_review_decide(${actor}, ${tenantId}, ${approve}, ${reason ?? null}, ${ip}::inet) as status`.catch(mapPlatformError);
    return { reviewStatus: rows[0]?.status ?? (approve ? "approved" : "rejected") };
  }
}

@Controller("platform")
@UseGuards(PlatformAdminGuard)
export class PlatformPoliciesController {
  constructor(@Inject(PlatformPoliciesService) private readonly svc: PlatformPoliciesService) {}

  @Get("business-categories")
  categories(@CurrentUser() user: RequestUser): Promise<PlatformBusinessCategoryList> {
    return this.svc.categories(user.id);
  }

  /** Edits a rule; existing tenants are never re-evaluated automatically. */
  @Put("business-categories/:key")
  @HttpCode(204)
  upsert(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("key") key: string, @Body() body: unknown): Promise<void> {
    return this.svc.upsertCategory(user.id, req.ip || null, key, body);
  }

  @Get("channel-quality-alerts")
  qualityAlerts(@CurrentUser() user: RequestUser, @Query() query: unknown): Promise<PlatformQualityAlertList> {
    return this.svc.qualityAlerts(user.id, parseOrThrow(platformQualityAlertQuerySchema, query).days);
  }

  @Get("category-reviews")
  reviews(@CurrentUser() user: RequestUser, @Query() query: unknown): Promise<PlatformCategoryReviewList> {
    return this.svc.reviews(user.id, parseOrThrow(platformCategoryReviewQuerySchema, query).status);
  }

  @Post("category-reviews/:tenantId")
  @HttpCode(200)
  decide(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("tenantId") tenantId: string, @Body() body: unknown): Promise<{ reviewStatus: string }> {
    const input = parseOrThrow(categoryReviewDecisionRequestSchema, body);
    return this.svc.decide(user.id, req.ip || null, parseOrThrow(uuidSchema, tenantId), input.approve, input.reason);
  }
}
