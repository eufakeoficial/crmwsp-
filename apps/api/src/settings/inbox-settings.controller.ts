import { Body, Controller, Get, HttpCode, Patch, Req, UseGuards } from "@nestjs/common";
import { NotFoundError, patchInboxSettingsRequestSchema, resolveInboxSettings, type InboxSettings } from "@crmwsp/contracts";
import { eq, sql, tenants } from "@crmwsp/db";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

/** Inbox settings of the tenant (tenants.settings.inbox, T23). */
@Controller("settings/inbox")
@UseGuards(TenantGuard)
export class InboxSettingsController {
  @Get()
  async get(@CurrentTenantDb() db: TenantDb): Promise<InboxSettings> {
    return db.run(async (tx) => {
      const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId));
      return resolveInboxSettings(t?.settings["inbox"]);
    });
  }

  @Patch()
  @Roles("owner", "admin")
  @HttpCode(200)
  async patch(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<InboxSettings> {
    const patch = parseOrThrow(patchInboxSettingsRequestSchema, body);
    return db.run(async (tx) => {
      const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, db.tenantId)).for("update");
      if (!t) throw new NotFoundError();
      // Re-resolved so the stored object is always complete and valid.
      const next: InboxSettings = resolveInboxSettings({ ...resolveInboxSettings(t.settings["inbox"]), ...patch });
      await tx
        .update(tenants)
        .set({
          settings: sql`${tenants.settings} || jsonb_build_object('inbox', ${JSON.stringify(next)}::jsonb)`,
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, db.tenantId));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "tenant",
        entityId: db.tenantId,
        action: "inbox_settings.updated",
        diff: patch,
        ip: req.ip,
      });
      return next;
    });
  }
}
