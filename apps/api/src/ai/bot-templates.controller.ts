import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  applyBotTemplateRequestSchema,
  type AgentConfig,
  type ApplyBotTemplateResponse,
  type BotTemplateList,
} from "@crmwsp/contracts";
import { agentConfigs, and, desc, eq } from "@crmwsp/db";
import { composeTemplatePrompt, getBotTemplate, listBotTemplates } from "@crmwsp/domain";
import { CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";

/**
 * Sales-bot template gallery.
 * - `GET /bot-templates`: static presets (200 `BotTemplateList`).
 * - `POST /bot-templates/:id/apply` body `{ overwrite?: boolean }`: copies the preset into the
 *   active agent config as a new version (200 `ApplyBotTemplateResponse`); 404 unknown template,
 *   409 when a non-empty prompt exists and `overwrite` is not true. Owner/admin only.
 */
@Controller("bot-templates")
@UseGuards(TenantGuard)
export class BotTemplatesController {
  @Get()
  @Roles("owner", "admin", "agent")
  list(): BotTemplateList {
    return { items: [...listBotTemplates()] };
  }

  @Post(":id/apply")
  @HttpCode(200)
  @Roles("owner", "admin")
  async apply(
    @CurrentTenantDb() db: TenantDb,
    @Param("id") id: string,
    @Body() body: unknown,
    @Req() req: HttpRequest,
  ): Promise<ApplyBotTemplateResponse> {
    const { overwrite } = parseOrThrow(applyBotTemplateRequestSchema, body ?? {});
    const template = getBotTemplate(id);
    if (!template) throw new NotFoundError("Bot template not found");
    const systemPrompt = composeTemplatePrompt(template);
    let result: AgentConfig | undefined;
    try {
      await db.run(async (tx) => {
        const [current] = await tx.select().from(agentConfigs).where(eq(agentConfigs.isActive, true)).for("update");
        if (current && current.systemPrompt.trim() !== "" && overwrite !== true) {
          throw new ConflictError("The agent already has a prompt; pass overwrite: true to replace it");
        }
        const [latest] = await tx
          .select({ version: agentConfigs.version })
          .from(agentConfigs)
          .where(and(eq(agentConfigs.tenantId, db.tenantId)))
          .orderBy(desc(agentConfigs.version))
          .limit(1);
        if (current) await tx.update(agentConfigs).set({ isActive: false, updatedAt: new Date() }).where(eq(agentConfigs.id, current.id));
        const version = (latest?.version ?? 0) + 1;
        const aiModeDefault = current?.aiModeDefault ?? "assist";
        const confidence = current?.confidenceThreshold ?? "0.75";
        const approval = current?.approvalThresholdMinor ?? null;
        const [created] = await tx
          .insert(agentConfigs)
          .values({
            tenantId: db.tenantId,
            version,
            systemPrompt,
            aiModeDefault,
            confidenceThreshold: confidence,
            approvalThresholdMinor: approval,
            policies: current?.policies ?? {},
            isActive: true,
            createdBy: db.userId,
          })
          .returning({ id: agentConfigs.id });
        if (!created) throw new Error("insert returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "agent_config",
          entityId: created.id,
          action: "agent_config.template_applied",
          diff: { version, templateId: template.id, templateVersion: template.version, overwrite: overwrite === true },
          ip: req.ip,
        });
        result = {
          systemPrompt,
          aiModeDefault,
          confidenceThreshold: Number(confidence),
          approvalThresholdMinor: approval === null ? null : Number(approval),
        };
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("The agent configuration was changed concurrently");
      throw err;
    }
    if (!result) throw new Error("apply produced no config");
    return { templateId: template.id, templateVersion: template.version, agentConfig: result };
  }
}
