import { Body, Controller, Get, HttpCode, Patch, Req, UseGuards } from "@nestjs/common";
import { NotFoundError, patchCurrencySettingsRequestSchema, resolveCurrencySettings, type CurrencySettings } from "@crmwsp/contracts";
import { eq, sql, tenants } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

/**
 * Currency settings (T28): base in tenants.currency, enabled list in tenants.settings.currencies.
 * Changing the base never converts existing amounts: every record keeps its own currency.
 */
@Controller("settings/currency")
@UseGuards(TenantGuard)
export class CurrencySettingsController {
  @Get()
  async get(@CurrentTenantDb() db: TenantDb): Promise<CurrencySettings> {
    return db.run(async (tx) => {
      const [t] = await tx.select({ currency: tenants.currency, settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId));
      if (!t) throw new NotFoundError();
      return resolveCurrencySettings(t.currency, t.settings["currencies"]);
    });
  }

  @Patch()
  @Roles("owner", "admin")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<CurrencySettings> {
    const input = parseOrThrow(patchCurrencySettingsRequestSchema, body);
    const next = resolveCurrencySettings(input.base, input.enabled);
    return db.run(async (tx) => {
      const [t] = await tx.select({ currency: tenants.currency, settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId)).for("update");
      if (!t) throw new NotFoundError();
      const before = resolveCurrencySettings(t.currency, t.settings["currencies"]);
      await tx
        .update(tenants)
        .set({
          currency: next.base,
          settings: sql`${tenants.settings} || jsonb_build_object('currencies', ${JSON.stringify(next.enabled)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, db.tenantId));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: db.tenantId,
        action: "currency_settings.updated",
        diff: { before, after: next },
        ip: req.ip,
      });
      return next;
    });
  }
}
