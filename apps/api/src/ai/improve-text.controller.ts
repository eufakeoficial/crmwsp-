import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { improveTextRequestSchema, type ImproveTextResponse } from "@crmwsp/contracts";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { ImproveTextService } from "./improve-text.service.js";

/** Composer helper: owners, admins and agents can rewrite (viewers cannot spend the LLM budget) a draft; the text is returned, never sent. */
@Controller("ai")
@UseGuards(TenantGuard)
export class ImproveTextController {
  constructor(@Inject(ImproveTextService) private readonly service: ImproveTextService) {}

  @Post("improve-text")
  @Roles("owner", "admin", "agent")
  @HttpCode(200)
  improve(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<ImproveTextResponse> {
    return this.service.improve(db, parseOrThrow(improveTextRequestSchema, body));
  }
}
