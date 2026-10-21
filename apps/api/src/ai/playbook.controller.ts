import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { savePlaybookRequestSchema, type PlaybookResponse } from "@crmwsp/contracts";
import { eq, salesPlaybooks, type SalesPlaybook } from "@crmwsp/db";
import { DEFAULT_PLAYBOOK, playbookConfigColumn, resolvePlaybook } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { writeAudit } from "../inbox/audit.js";

export function toPlaybookDto(row: SalesPlaybook | undefined): PlaybookResponse {
  if (!row) return { ...DEFAULT_PLAYBOOK, saved: false, updatedAt: null };
  return { ...resolvePlaybook(row), saved: true, updatedAt: row.updatedAt.toISOString() };
}

/** Sales playbook of the tenant (ethical sales guidance for the AI). Owners and admins edit it. */
@Controller("ai/playbook")
@UseGuards(TenantGuard)
export class PlaybookController {
  @Get()
  @Roles("owner", "admin")
  async get(@CurrentTenantDb() db: TenantDb): Promise<PlaybookResponse> {
    const [row] = await db.run((tx) => tx.select().from(salesPlaybooks).limit(1));
    return toPlaybookDto(row);
  }

  @Put()
  @Roles("owner", "admin")
  async save(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<PlaybookResponse> {
    const input = parseOrThrow(savePlaybookRequestSchema, body);
    const cols = { enabled: input.enabled, config: playbookConfigColumn(input), updatedBy: db.userId, updatedAt: new Date() };
    const row = await db.run(async (tx) => {
      const [existing] = await tx.select({ id: salesPlaybooks.id }).from(salesPlaybooks).for("update");
      const [saved] = existing
        ? await tx.update(salesPlaybooks).set(cols).where(eq(salesPlaybooks.id, existing.id)).returning()
        : await tx.insert(salesPlaybooks).values({ tenantId: db.tenantId, ...cols }).returning();
      if (!saved) throw new Error("save returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "sales_playbook",
        entityId: saved.id,
        action: existing ? "sales_playbook.updated" : "sales_playbook.created",
        diff: { enabled: input.enabled, closingStyle: input.closingStyle, objections: input.objections.length, followUp: input.followUp },
        ip: req.ip,
      });
      return saved;
    });
    return toPlaybookDto(row);
  }
}
