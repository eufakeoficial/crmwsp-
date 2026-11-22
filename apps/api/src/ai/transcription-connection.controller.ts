import { Body, Controller, Delete, Get, HttpCode, Inject, Post, Put, Req, UseGuards } from "@nestjs/common";
import { tinyWav } from "@crmwsp/ai";
import { redact, type CipherBox } from "@crmwsp/crypto";
import {
  ConflictError,
  EncryptionNotConfiguredError,
  ValidationError,
  saveAiTranscriptionConnectionRequestSchema,
  type AiTranscriptionConnection,
  type AiTranscriptionStatus,
  type AiTranscriptionTestResult,
} from "@crmwsp/contracts";
import {
  eq,
  isActiveChatConnection,
  isActiveTranscriptionConnection,
  llmConnections,
  type LlmConnection,
} from "@crmwsp/db";
import { resolveTranscriptionSource } from "@crmwsp/domain";
import { CurrentTenant, CurrentTenantDb, Roles } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest, RequestTenant } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { PG_UNIQUE_VIOLATION, pgCode, writeAudit } from "../inbox/audit.js";
import { LLM_API_KEY_PURPOSE } from "./ai.constants.js";
import { resolveBaseUrl } from "./ai.controller.js";
import { LlmProviderFactory } from "./llm-provider.factory.js";

const ADMIN_ROLES = new Set(["owner", "admin"]);
const MAX_ERROR_CHARS = 500;

function candidate(row: LlmConnection | undefined) {
  return row
    ? { hasKey: row.apiKeyEncrypted !== null, lastTestOk: row.lastTestOk, transcription: row.capabilities.transcription === true }
    : null;
}

/**
 * Optional dedicated audio transcription connection (ADR 0024). Same tenant-bound encryption
 * (purpose + tenant AAD) and SSRF policy as the chat connection; the key is write-only.
 */
@Controller("ai/transcription-connection")
@UseGuards(TenantGuard)
export class TranscriptionConnectionController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(LlmProviderFactory) private readonly providers: LlmProviderFactory,
  ) {}

  private toDto(row: LlmConnection, privileged: boolean): AiTranscriptionConnection {
    return {
      purpose: "transcription",
      provider: row.provider,
      baseUrl: row.baseUrl,
      apiKeyHint: privileged ? row.apiKeyHint : null,
      model: row.modelCheap,
      lastTestedAt: row.lastTestedAt ? row.lastTestedAt.toISOString() : null,
      lastTestOk: row.lastTestOk,
    };
  }

  @Get()
  @Roles("owner", "admin", "agent")
  async get(@CurrentTenantDb() db: TenantDb, @CurrentTenant() tenant: RequestTenant): Promise<AiTranscriptionStatus> {
    const [dedicated, chat] = await db.run(async (tx) => [
      (await tx.select().from(llmConnections).where(isActiveTranscriptionConnection).limit(1))[0],
      (await tx.select().from(llmConnections).where(isActiveChatConnection).limit(1))[0],
    ]);
    return {
      connection: dedicated ? this.toDto(dedicated, ADMIN_ROLES.has(tenant.role)) : null,
      source: resolveTranscriptionSource(candidate(dedicated), candidate(chat)),
    };
  }

  @Put()
  @Roles("owner", "admin")
  async save(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<AiTranscriptionConnection> {
    const input = parseOrThrow(saveAiTranscriptionConnectionRequestSchema, body);
    const baseUrl = await resolveBaseUrl(input.provider, input.baseUrl);
    let encrypted: Buffer | undefined;
    if (input.apiKey !== undefined) {
      if (!this.cipher) throw new EncryptionNotConfiguredError();
      encrypted = this.cipher.encrypt(input.apiKey, { tenantId: db.tenantId, purpose: LLM_API_KEY_PURPOSE });
    }
    try {
      const row = await db.run(async (tx) => {
        const [existing] = await tx.select().from(llmConnections).where(isActiveTranscriptionConnection).for("update");
        if (!existing && encrypted === undefined) {
          throw new ValidationError("Validation failed", {
            details: [{ path: "apiKey", message: "apiKey is required for the first connection" }],
          });
        }
        const common = { provider: input.provider, baseUrl, modelCheap: input.model, modelStrong: null, updatedAt: new Date() };
        // A different endpoint, provider, model or key invalidates the previous test.
        const changed =
          !existing ||
          encrypted !== undefined ||
          existing.baseUrl !== baseUrl ||
          existing.provider !== input.provider ||
          existing.modelCheap !== input.model;
        const reset = changed ? { capabilities: {}, lastTestedAt: null, lastTestOk: null } : {};
        const keyCols = encrypted !== undefined ? { apiKeyEncrypted: encrypted, apiKeyHint: redact(input.apiKey as string) } : {};
        const [saved] = existing
          ? await tx
              .update(llmConnections)
              .set({ ...common, ...keyCols, ...reset })
              .where(eq(llmConnections.id, existing.id))
              .returning()
          : await tx
              .insert(llmConnections)
              .values({ tenantId: db.tenantId, purpose: "transcription", isActive: true, ...common, ...keyCols })
              .returning();
        if (!saved) throw new Error("save returned no row");
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "llm_connection",
          entityId: saved.id,
          action: existing ? "llm_connection.updated" : "llm_connection.created",
          // Never the key: only whether it was replaced.
          diff: { purpose: "transcription", provider: input.provider, baseUrl, model: input.model, keyReplaced: encrypted !== undefined },
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

  /** Real transcription of 0.1 s of silence: proves key, endpoint and model, nothing else. */
  @Post("test")
  @Roles("owner", "admin")
  @HttpCode(200)
  async test(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<AiTranscriptionTestResult> {
    const [row] = await db.run((tx) => tx.select().from(llmConnections).where(isActiveTranscriptionConnection));
    if (!row) throw new ValidationError("No transcription connection is configured");
    const started = Date.now();
    let apiKey = "";
    let result: AiTranscriptionTestResult;
    try {
      if (!this.cipher) throw new EncryptionNotConfiguredError();
      if (!row.apiKeyEncrypted) throw new Error("no key");
      apiKey = this.cipher.decrypt(row.apiKeyEncrypted, { tenantId: db.tenantId, purpose: LLM_API_KEY_PURPOSE });
      const provider = this.providers.create({ baseUrl: row.baseUrl, apiKey });
      await provider.transcribe({ model: row.modelCheap, audio: tinyWav(), mimeType: "audio/wav" });
      result = { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      // Never a 500 for provider/setup failures; the message is sanitized.
      let msg =
        err instanceof EncryptionNotConfiguredError
          ? "Encryption is not configured"
          : err instanceof Error
            ? err.message
            : "Transcription test failed";
      if (apiKey) msg = msg.split(apiKey).join("[redacted]");
      result = { ok: false, latencyMs: Date.now() - started, error: msg.slice(0, MAX_ERROR_CHARS) };
    }
    await db.run(async (tx) => {
      await tx
        .update(llmConnections)
        .set({ capabilities: { transcription: result.ok }, lastTestedAt: new Date(), lastTestOk: result.ok, updatedAt: new Date() })
        .where(eq(llmConnections.id, row.id));
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "llm_connection",
        entityId: row.id,
        action: "llm_connection.tested",
        diff: { purpose: "transcription", ok: result.ok },
        ip: req.ip,
      });
    });
    return result;
  }

  @Delete()
  @Roles("owner", "admin")
  @HttpCode(204)
  async remove(@CurrentTenantDb() db: TenantDb, @Req() req: HttpRequest): Promise<void> {
    await db.run(async (tx) => {
      const deleted = await tx.delete(llmConnections).where(isActiveTranscriptionConnection).returning({ id: llmConnections.id });
      for (const d of deleted) {
        await writeAudit(tx, {
          tenantId: db.tenantId,
          userId: db.userId,
          entity: "llm_connection",
          entityId: d.id,
          action: "llm_connection.deleted",
          diff: { purpose: "transcription" },
          ip: req.ip,
        });
      }
    });
  }
}
