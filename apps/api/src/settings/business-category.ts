import { Body, Controller, Get, HttpCode, Inject, Put, Req, UseGuards } from "@nestjs/common";
import { ValidationError, setBusinessCategoryRequestSchema, type BusinessCategoryListResponse, type BusinessCategoryState } from "@crmwsp/contracts";
import { CurrentTenantDb, Public, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";
import { BusinessCategoryService } from "./business-category.service.js";

@Controller("business-categories")
export class PublicBusinessCategoriesController {
  constructor(@Inject(BusinessCategoryService) private readonly categories: BusinessCategoryService) {}

  /** Public: the signup form needs the taxonomy before there is a session. */
  @Public()
  @Get()
  async list(): Promise<BusinessCategoryListResponse> {
    return { items: await this.categories.list() };
  }
}

@Controller("settings/business-category")
@UseGuards(TenantGuard)
export class BusinessCategoryController {
  constructor(@Inject(BusinessCategoryService) private readonly categories: BusinessCategoryService) {}

  @Get()
  get(@CurrentTenantDb() db: TenantDb): Promise<BusinessCategoryState> {
    return db.run((tx) => this.categories.state(tx, db.tenantId));
  }

  @Put()
  @Roles("owner", "admin")
  @HttpCode(200)
  async put(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<BusinessCategoryState> {
    const input = parseOrThrow(setBusinessCategoryRequestSchema, body);
    const decision = await this.categories.decide(input.category);
    if (decision.outcome === "refused") throw new ValidationError(decision.message);
    return db.run(async (tx) => {
      const status = await this.categories.setInTx(tx, db.tenantId, input.category, input.detail ?? null);
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: db.tenantId,
        action: "business_category.set",
        diff: { category: input.category, reviewStatus: status },
        ip: req.ip,
      });
      return this.categories.state(tx, db.tenantId);
    });
  }
}
