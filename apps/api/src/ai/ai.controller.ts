import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { assertSafeBaseUrl } from "@crmwsp/ai";
import { redact, type CipherBox } from "@crmwsp/crypto";
import {
  AI_PROVIDER_BASE_URLS,
  ConflictError,
  EncryptionNotConfiguredError,
  ValidationError,
  aiUsageQuerySchema,
  agentConfigSchema,
  saveAiConnectionRequestSchema,
  type AgentConfig,
  type AiCapabilities,
  type AiConnection,
  type AiTestResult,
  type AiUsage,
  type AiProvider,
} from "@crmwsp/contracts";
import {
  agentConfigs,
  and,
  desc,
  eq,
  llmConnections,
  sql,
  tenants,
  type LlmConnection,
} from "@crmwsp/db";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { LLM_API_KEY_PURPOSE } from "./ai.constants.js";
import { spendByKind } from "./usage.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const MAX_ERROR_CHARS = 500;


/** Public-IP stub: tests run offline, so DNS is not resolved for `custom` URLs when NODE_ENV=test. */
const TEST_LOOKUP = async () => [{ address: "93.184.216.34" }];

/**
 * Resolves the stored base URL. Preset providers use fixed URLs; `custom` is checked with the
 * anti-SSRF policy in production mode (https only, public hosts only), except under NODE_ENV=test
 * where DNS is stubbed (literal private IPs and local names are still rejected).
 */
export async function resolveBaseUrl(provider: AiProvider, raw: string | undefined): Promise<string> {
  if (provider !== "custom") return AI_PROVIDER_BASE_URLS[provider];
  try {
    const opts =
      process.env["NODE_ENV"] === "test" ? { production: false, lookup: TEST_LOOKUP } : { production: true };
    const url = await assertSafeBaseUrl((raw ?? "").trim(), opts);
    return url.toString().replace(/\/+$/, "");
  } catch (err) {
    // UnsafeBaseUrlError / DNS errors carry a reason, never the key.
    throw new ValidationError(err instanceof Error ? err.message : "Invalid base URL", {
      details: [{ path: "baseUrl", message: "base URL rejected by the security policy" }],
    });
  }
}

function currentMonthUtc(): string {
  return new Date().toISOString().slice(0, 7);
}

const DEFAULT_AGENT_CONFIG: AgentConfig = {
  systemPrompt: "",
  aiModeDefault: "assist",
  confidenceThreshold: 0.75,
  approvalThresholdMinor: null,
};

@Controller("ai")
@UseGuards(TenantGuard)
export class AiController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(LlmProviderFactory) private readonly providers: LlmProviderFactory,
  ) {}

  private toDto(row: LlmConnection, privileged: boolean): AiConnection {
    const caps = row.capabilities;
    return {
      provider: row.provider,
      baseUrl: row.baseUrl,
      apiKeyHint: privileged ? row.apiKeyHint : null,
      modelCheap: row.modelCheap,
      modelStrong: row.modelStrong ?? row.modelCheap,
      capabilities: {
        structuredOutput: caps.structuredOutput === true,
        embeddings: caps.embeddings === true,
        transcription: caps.transcription === true,
      },
      lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
      lastTestOk: row.lastTestOk,
      monthlyBudgetMinor: row.monthlyBudgetMinor === null ? null : Number(row.monthlyBudgetMinor),
      budgetCurrency: row.budgetCurrency,
    };
  }

  @Get("connection")
  @Roles("owner", "admin", "agent")
  async getConnection(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant): Promise<AiConnection | null> {
    const [row] = await db.run((tx) => tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)));
    return row ? this.toDto(row, ADMIN_ROLES.has(tenant.role)) : null;
  }

  @Put("connection")
  @Roles("owner", "admin")
  async saveConnection(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<AiConnection> {
    const input = parseOrThrow(saveAiConnectionRequestSchema, body);
    const baseUrl = await resolveBaseUrl(input.provider, input.baseUrl);
    let encrypted: Buffer | undefined;
    if (input.apiKey !== undefined) {
      if (!this.cipher) throw new EncryptionNotConfiguredError();
      encrypted = this.cipher.encrypt(input.apiKey, { tenantId: db.tenantId, purpose: LLM_API_KEY_PURPOSE });
    }
    try {
      const row = await db.run(async (tx) => {
        const [existing] = await tx
          .select()
          .from(llmConnections)
          .where(eq(llmConnections.isActive, true))
          .for("update");
        if (!existing && encrypted === undefined) {
          throw new ValidationError("Validation failed", {
            details: [{ path: "apiKey", message: "apiKey is required for the first connection" }],
          });
        }
        const budget =
          input.monthlyBudgetMinor === undefined
            ? { monthlyBudgetMinor: null, budgetCurrency: null }
            : { monthlyBudgetMinor: BigInt(input.monthlyBudgetMinor), budgetCurrency: input.budgetCurrency ?? null };
        const common = {
          provider: input.provider,
          baseUrl,
          modelCheap: input.modelCheap,
          modelStrong: input.modelStrong,
          ...budget,
          updatedAt: new Date(),
        };
        // A different endpoint, provider or key invalidates previous test results.
        const changed =
          !existing ||
          encrypted !== undefined ||
          existing.baseUrl !== baseUrl ||
          existing.provider !== input.provider;
        const reset = changed ? { capabilities: {}, lastTestedAt: null, lastTestOk: null } : {};
        const keyCols = encrypted !== undefined ? { apiKeyEncrypted: encrypted, apiKeyHint: redact(input.apiKey as string) } : {};
        let saved: LlmConnection | undefined;
        if (existing) {
          [saved] = await tx
            .update(llmConnections)
            .set({ ...common, ...keyCols, ...reset })
            .where(eq(llmConnections.id, existing.id))
            .returning();
        } else {
          [saved] = await tx
            .insert(llmConnections)
            .values({ tenantId: db.tenantId, isActive: true, ...common, ...keyCols })
            .returning();
        }
        if (!saved) throw new Error("save returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "llm_connection",
          entityId: saved.id,
          action: existing ? "llm_connection.updated" : "llm_connection.created",
          // Never the key: only whether it was replaced.
          diff: {
            provider: input.provider,
            baseUrl,
            modelCheap: input.modelCheap,
            modelStrong: input.modelStrong,
            keyReplaced: encrypted !== undefined,
            monthlyBudgetMinor: input.monthlyBudgetMinor ?? null,
          },
          ip: req.ip,
        });
        return saved;
      });
      return this.toDto(row, true);
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("The connection was changed concurrently");
      throw err;
    }
  }

  @Post("connection/test")
  @Roles("owner", "admin")
  @HttpCode(200)
  async testConnection(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<AiTestResult> {
    const [row] = await db.run((tx) => tx.select().from(llmConnections).where(eq(llmConnections.isActive, true)));
    if (!row) throw new ValidationError("No AI connection is configured");
    const started = Date.now();
    const noCaps: AiCapabilities = { structuredOutput: false, embeddings: false, transcription: false };
    let apiKey = "";
    let result: AiTestResult;
    try {
      if (!this.cipher) throw new EncryptionNotConfiguredError();
      if (!row.apiKeyEncrypted) throw new Error("no key");
      apiKey = this.cipher.decrypt(row.apiKeyEncrypted, { tenantId: db.tenantId, purpose: LLM_API_KEY_PURPOSE });
      const provider = this.providers.create({ baseUrl: row.baseUrl, apiKey });
      const r = await provider.testConnection({ modelCheap: row.modelCheap, modelStrong: row.modelStrong ?? row.modelCheap });
      result = { ok: r.ok, capabilities: r.capabilities, latencyMs: r.latencyMs };
      if (r.error) result.error = r.error;
    } catch (err) {
      // Never a 500 for provider/setup failures; the message is sanitized below.
      const reason = err instanceof EncryptionNotConfiguredError ? "Encryption is not configured" : err instanceof Error ? err.message : "Connection test failed";
      result = { ok: false, capabilities: noCaps, latencyMs: Date.now() - started, error: reason };
    }
    if (result.error !== undefined) {
      let msg = result.error;
      if (apiKey) msg = msg.split(apiKey).join("[redacted]");
      result.error = msg.slice(0, MAX_ERROR_CHARS);
    }
    await db.run(async (tx) => {
      await tx
        .update(llmConnections)
        .set({
          capabilities: result.capabilities,
          lastTestedAt: new Date(),
          lastTestOk: result.ok,
          updatedAt: new Date(),
        })
        .where(eq(llmConnections.id, row.id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "llm_connection",
        entityId: row.id,
        action: "llm_connection.tested",
        diff: { ok: result.ok, capabilities: result.capabilities },
        ip: req.ip,
      });
    });
    return result;
  }

  @Delete("connection")
  @Roles("owner", "admin")
  @HttpCode(204)
  async deleteConnection(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<void> {
    await db.run(async (tx) => {
      const deleted = await tx.delete(llmConnections).where(eq(llmConnections.isActive, true)).returning({ id: llmConnections.id });
      for (const d of deleted) {
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "llm_connection",
          entityId: d.id,
          action: "llm_connection.deleted",
          ip: req.ip,
        });
      }
    });
  }

  @Get("usage")
  @Roles("owner", "admin", "agent")
  async usage(@CurrentTenantDb() db: TenantDb, @Query() query: unknown): Promise<AiUsage> {
    const { month = currentMonthUtc() } = parseOrThrow(aiUsageQuerySchema, query);
    // Mid-month instant: tenant_monthly_spend truncates it in the tenant's timezone.
    const instant = new Date(`${month}-15T12:00:00.000Z`).toISOString();
    return db.run(async (tx) => {
      const [conn] = await tx.select().from(llmConnections).where(eq(llmConnections.isActive, true));
      const [tenant] = await tx.select({ currency: tenants.currency }).from(tenants).where(eq(tenants.id, db.tenantId));
      const currency = conn?.budgetCurrency ?? tenant?.currency ?? "EUR";
      const rows = (await tx.execute(
        sql`select currency, kind, cost_minor from tenant_monthly_spend(${instant}::timestamptz)`,
      )) as unknown as Array<{ currency: string; kind: string; cost_minor: string }>;
      // Same month bounds as tenant_monthly_spend (tenant timezone) to split out the USD micro-cent
      // rows and detect unverified prices; both need `meta`, which the function does not return.
      const meta = (await tx.execute(sql`
        with tz as (
          select coalesce((select t.timezone from tenants t where t.id = nullif(current_setting('app.tenant_id', true), '')::uuid), 'UTC') as name
        ), b as (select date_trunc('month', ${instant}::timestamptz, tz.name) as lo, tz.name from tz)
        select u.kind::text as kind,
               coalesce(sum(u.cost_minor) filter (where u.meta->>'unit' = 'usd_microcents' and u.currency = 'USD'), 0) as micro,
               coalesce(bool_or(u.meta->>'verified' = 'false'), false) as unverified
        from usage_ledger u, b
        where u.occurred_at >= b.lo and u.occurred_at < date_add(b.lo, interval '1 month', b.name)
        group by u.kind`)) as unknown as Array<{ kind: string; micro: string; unverified: boolean }>;
      const microOf = new Map(meta.map((m) => [m.kind, Number(m.micro)]));
      // Only the reporting currency is summed; micro-cents convert to USD only (no FX).
      const kinds = rows
        .filter((r) => r.currency === currency)
        .map((r) => ({ kind: r.kind, total: Number(r.cost_minor), micro: currency === "USD" ? (microOf.get(r.kind) ?? 0) : 0 }));
      const mismatchProbe = currency === "USD" ? kinds : [...microOf].map(([kind, micro]) => ({ kind, total: 0, micro }));
      const { byKind } = spendByKind(currency, kinds);
      const { currencyMismatch } = spendByKind(currency, mismatchProbe);
      return {
        spentMinor: byKind.reduce((sum, k) => sum + k.costMinor, 0),
        currency,
        budgetMinor: conn?.monthlyBudgetMinor == null ? null : Number(conn.monthlyBudgetMinor),
        currencyMismatch,
        estimated: meta.some((m) => m.unverified),
        byKind,
      };
    });
  }

  @Get("agent-config")
  @Roles("owner", "admin", "agent")
  async getAgentConfig(@CurrentTenantDb() db: TenantDb): Promise<AgentConfig> {
    const [row] = await db.run((tx) => tx.select().from(agentConfigs).where(eq(agentConfigs.isActive, true)));
    if (!row) return DEFAULT_AGENT_CONFIG;
    return {
      systemPrompt: row.systemPrompt,
      aiModeDefault: row.aiModeDefault,
      confidenceThreshold: Number(row.confidenceThreshold),
      approvalThresholdMinor: row.approvalThresholdMinor === null ? null : Number(row.approvalThresholdMinor),
    };
  }

  /** Saves a new version and makes it the only active one (older versions stay for history). */
  @Put("agent-config")
  @Roles("owner", "admin")
  async saveAgentConfig(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<AgentConfig> {
    const input = parseOrThrow(agentConfigSchema, body);
    try {
      await db.run(async (tx) => {
        const [current] = await tx.select().from(agentConfigs).where(eq(agentConfigs.isActive, true)).for("update");
        const [latest] = await tx
          .select({ version: agentConfigs.version })
          .from(agentConfigs)
          .where(and(eq(agentConfigs.tenantId, db.tenantId)))
          .orderBy(desc(agentConfigs.version))
          .limit(1);
        if (current) await tx.update(agentConfigs).set({ isActive: false, updatedAt: new Date() }).where(eq(agentConfigs.id, current.id));
        const version = (latest?.version ?? 0) + 1;
        const [created] = await tx
          .insert(agentConfigs)
          .values({
            tenantId: db.tenantId,
            version,
            systemPrompt: input.systemPrompt,
            aiModeDefault: input.aiModeDefault,
            confidenceThreshold: input.confidenceThreshold.toFixed(2),
            approvalThresholdMinor: input.approvalThresholdMinor === null ? null : BigInt(input.approvalThresholdMinor),
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
          action: "agent_config.updated",
          diff: {
            version,
            aiModeDefault: input.aiModeDefault,
            confidenceThreshold: input.confidenceThreshold,
            approvalThresholdMinor: input.approvalThresholdMinor,
            systemPromptChars: input.systemPrompt.length,
          },
          ip: req.ip,
        });
      });
    } catch (err) {
      if (pgCode(err) === PG_UNIQUE_VIOLATION) throw new ConflictError("The agent configuration was changed concurrently");
      throw err;
    }
    return input;
  }
}
