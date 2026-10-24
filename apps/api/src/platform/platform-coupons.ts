import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  platformCouponSaveRequestSchema,
  uuidSchema,
  type PlatformCoupon,
  type PlatformCouponList,
  type PlatformCouponRedemptionList,
  type PlatformCouponSaveRequest,
} from "@crmwsp/contracts";
import { CurrentUser } from "../auth/decorators.js";
import { DB_HANDLE, type DbHandle, type HttpRequest, type RequestUser } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import { pgCode } from "../inbox/audit.js";
import { PlatformAdminGuard } from "./platform-admin.guard.js";

type CouponRow = {
  coupon_id: string;
  code: string;
  type: PlatformCoupon["type"];
  value: string;
  plans: string[] | null;
  period: PlatformCoupon["period"];
  max_redemptions: number | null;
  per_tenant_limit: number;
  valid_from: Date | null;
  valid_until: Date | null;
  active: boolean;
  created_at: Date;
  redemptions: number;
  holds: number;
};

const iso = (d: Date | string | null): string | null => (d === null ? null : new Date(d).toISOString());

function mapDbError(err: unknown): never {
  switch (pgCode(err)) {
    case "42501":
    case "P0002":
      throw new NotFoundError();
    case "23505":
      throw new ConflictError("Coupon code already exists");
    case "22023":
      throw new ValidationError("Invalid coupon");
    default:
      throw err;
  }
}

/**
 * Platform coupons (ADR 0017) over the `platform_coupon_*` SECURITY DEFINER functions of
 * migration 0071; every call re-checks the actor against platform_admins and is audited.
 */
@Injectable()
export class PlatformCouponsService {
  constructor(@Inject(DB_HANDLE) private readonly handle: DbHandle) {}

  async list(actor: string): Promise<PlatformCouponList> {
    const rows = await this.handle.sql<CouponRow[]>`
      select coupon_id, code, type, value, plans, period, max_redemptions, per_tenant_limit, valid_from, valid_until, active,
             created_at, redemptions, holds
      from public.platform_coupon_list(${actor})`.catch(mapDbError);
    return {
      items: rows.map((r) => ({
        id: r.coupon_id,
        code: r.code,
        type: r.type,
        value: Number(r.value),
        plans: (r.plans ?? []).filter((p): p is "start" | "pro" => p === "start" || p === "pro"),
        period: r.period,
        maxRedemptions: r.max_redemptions,
        perTenantLimit: r.per_tenant_limit,
        validFrom: iso(r.valid_from),
        validUntil: iso(r.valid_until),
        active: r.active,
        createdAt: new Date(r.created_at).toISOString(),
        redemptions: Number(r.redemptions),
        holds: Number(r.holds),
      })),
    };
  }

  async save(actor: string, ip: string | null, id: string | null, c: PlatformCouponSaveRequest): Promise<PlatformCoupon> {
    const [row] = await this.handle.sql<{ id: string }[]>`
      select public.platform_coupon_save(${actor}, ${id}::uuid, ${c.code}, ${c.type}, ${c.value}::numeric, ${c.plans}::text[],
        ${c.period}, ${c.maxRedemptions}::integer, ${c.perTenantLimit}::integer, ${c.validFrom}::timestamptz,
        ${c.validUntil}::timestamptz, ${c.active}, ${ip}::inet) as id`.catch(mapDbError);
    const saved = (await this.list(actor)).items.find((x) => x.id === row?.id);
    if (!saved) throw new NotFoundError();
    return saved;
  }

  async remove(actor: string, ip: string | null, id: string): Promise<void> {
    await this.handle.sql`select public.platform_coupon_delete(${actor}, ${id}::uuid, ${ip}::inet)`.catch(mapDbError);
  }

  async redemptions(actor: string, couponId: string): Promise<PlatformCouponRedemptionList> {
    const rows = await this.handle.sql<
      {
        redemption_id: string;
        tenant_id: string;
        tenant_name: string;
        charge_id: string;
        plan: "start" | "pro";
        discount_amount: string;
        free_days: number;
        price_amount: string;
        created_at: Date;
      }[]
    >`select * from public.platform_coupon_redemptions(${actor}, ${couponId}::uuid)`.catch(mapDbError);
    return {
      items: rows.map((r) => ({
        id: r.redemption_id,
        tenantId: r.tenant_id,
        tenantName: r.tenant_name,
        chargeId: r.charge_id,
        plan: r.plan,
        discountAmount: r.discount_amount,
        freeDays: r.free_days,
        priceAmount: r.price_amount,
        createdAt: new Date(r.created_at).toISOString(),
      })),
    };
  }
}

/** `/platform/coupons` (admins only; non-admins get 404 from PlatformAdminGuard). */
@Controller("platform/coupons")
@UseGuards(PlatformAdminGuard)
export class PlatformCouponsController {
  constructor(@Inject(PlatformCouponsService) private readonly coupons: PlatformCouponsService) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<PlatformCouponList> {
    return this.coupons.list(user.id);
  }

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Body() body: unknown): Promise<PlatformCoupon> {
    return this.coupons.save(user.id, req.ip || null, null, parseOrThrow(platformCouponSaveRequestSchema, body));
  }

  @Put(":id")
  update(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string, @Body() body: unknown): Promise<PlatformCoupon> {
    return this.coupons.save(user.id, req.ip || null, parseOrThrow(uuidSchema, id), parseOrThrow(platformCouponSaveRequestSchema, body));
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@CurrentUser() user: RequestUser, @Req() req: HttpRequest, @Param("id") id: string): Promise<void> {
    return this.coupons.remove(user.id, req.ip || null, parseOrThrow(uuidSchema, id));
  }

  @Get(":id/redemptions")
  redemptions(@CurrentUser() user: RequestUser, @Param("id") id: string): Promise<PlatformCouponRedemptionList> {
    return this.coupons.redemptions(user.id, parseOrThrow(uuidSchema, id));
  }
}
