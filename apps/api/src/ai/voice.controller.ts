import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req, UseGuards } from "@nestjs/common";
import { TtsProviderError, type TTSProvider } from "@crmwsp/ai";
import { redact, type CipherBox } from "@crmwsp/crypto";
import {
  EncryptionNotConfiguredError,
  ValidationError,
  saveVoiceSettingsRequestSchema,
  testVoiceRequestSchema,
  type TestVoiceResult,
  type VoiceSettingsDto,
} from "@crmwsp/contracts";
import { eq, voiceSettings, type VoiceSettings } from "@crmwsp/db";
import { Roles, CurrentTenantDb } from "../auth/decorators.js";
import { TenantGuard } from "../auth/tenant.guard.js";
import type { HttpRequest } from "../common/http.js";
import { parseOrThrow } from "../common/zod.js";
import type { TenantDb } from "../db/tenant-db.js";
import { CIPHER_BOX } from "../channels/channels.constants.js";
import { writeAudit } from "../inbox/audit.js";
import { TTS_API_KEY_PURPOSE, TTS_PROVIDER } from "./ai.constants.js";

const DEFAULT_SAMPLE = "Hola, esta es una prueba de voz.";

export function toVoiceDto(row: VoiceSettings | undefined): VoiceSettingsDto {
  return {
    provider: "elevenlabs",
    apiKeyHint: row?.apiKeyHint ?? null,
    hasApiKey: Boolean(row?.apiKeyEncrypted),
    voiceId: row?.voiceId ?? null,
    modelId: row?.modelId ?? "eleven_multilingual_v2",
    replyMode: row?.replyMode ?? "off",
  };
}

@Controller("ai/voice")
@UseGuards(TenantGuard)
export class VoiceController {
  constructor(
    @Inject(CIPHER_BOX) private readonly cipher: CipherBox | null,
    @Inject(TTS_PROVIDER) private readonly tts: TTSProvider,
  ) {}

  @Get()
  @Roles("owner", "admin")
  async get(@CurrentTenantDb() db: TenantDb): Promise<VoiceSettingsDto> {
    const [row] = await db.run((tx) => tx.select().from(voiceSettings));
    return toVoiceDto(row);
  }

  @Put()
  @Roles("owner", "admin")
  async save(@CurrentTenantDb() db: TenantDb, @Body() body: unknown, @Req() req: HttpRequest): Promise<VoiceSettingsDto> {
    const input = parseOrThrow(saveVoiceSettingsRequestSchema, body);
    let encrypted: Buffer | undefined;
    if (input.apiKey !== undefined) {
      if (!this.cipher) throw new EncryptionNotConfiguredError();
      encrypted = this.cipher.encrypt(input.apiKey, { tenantId: db.tenantId, purpose: TTS_API_KEY_PURPOSE });
    }
    const row = await db.run(async (tx) => {
      const [existing] = await tx.select().from(voiceSettings).for("update");
      if (!existing?.apiKeyEncrypted && encrypted === undefined && input.replyMode !== "off") {
        throw new ValidationError("Validation failed", {
          details: [{ path: "apiKey", message: "apiKey is required to enable voice replies" }],
        });
      }
      const cols = {
        voiceId: input.voiceId,
        modelId: input.modelId,
        replyMode: input.replyMode,
        updatedAt: new Date(),
        ...(encrypted !== undefined ? { apiKeyEncrypted: encrypted, apiKeyHint: redact(input.apiKey as string) } : {}),
      };
      const [saved] = existing
        ? await tx.update(voiceSettings).set(cols).where(eq(voiceSettings.id, existing.id)).returning()
        : await tx.insert(voiceSettings).values({ tenantId: db.tenantId, ...cols }).returning();
      if (!saved) throw new Error("save returned no row");
      await writeAudit(tx, {
        tenantId: db.tenantId,
        userId: db.userId,
        entity: "voice_settings",
        entityId: saved.id,
        action: existing ? "voice_settings.updated" : "voice_settings.created",
        // Never the key: only whether it was replaced.
        diff: { voiceId: input.voiceId, modelId: input.modelId, replyMode: input.replyMode, keyReplaced: encrypted !== undefined },
        ip: req.ip,
      });
      return saved;
    });
    return toVoiceDto(row);
  }

  /** Synthesizes a short sample with the saved settings. Never echoes the key nor provider bodies. */
  @Post("test")
  @Roles("owner", "admin")
  @HttpCode(200)
  async test(@CurrentTenantDb() db: TenantDb, @Body() body: unknown): Promise<TestVoiceResult> {
    const input = parseOrThrow(testVoiceRequestSchema, body ?? {});
    const [row] = await db.run((tx) => tx.select().from(voiceSettings));
    if (!row?.apiKeyEncrypted || !row.voiceId) throw new ValidationError("Voice replies are not configured");
    if (!this.cipher) throw new EncryptionNotConfiguredError();
    const apiKey = this.cipher.decrypt(row.apiKeyEncrypted, { tenantId: db.tenantId, purpose: TTS_API_KEY_PURPOSE });
    try {
      const out = await this.tts.synthesize({ apiKey, voiceId: row.voiceId, modelId: row.modelId, text: input.text ?? DEFAULT_SAMPLE });
      return { ok: true, mimeType: out.mimeType, audioBase64: Buffer.from(out.audio).toString("base64"), error: null };
    } catch (err) {
      const msg = err instanceof TtsProviderError ? err.message : "TTS test failed";
      return { ok: false, mimeType: null, audioBase64: null, error: msg };
    }
  }
}
