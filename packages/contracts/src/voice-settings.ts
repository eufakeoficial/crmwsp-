import { z } from "zod";

/* Voice replies (TTS, BYOK ElevenLabs). The API key is write-only: responses carry only a hint. */

export const VOICE_REPLY_MODES = ["off", "mirror", "always"] as const;
export const voiceReplyModeSchema = z.enum(VOICE_REPLY_MODES);
export type VoiceReplyMode = z.infer<typeof voiceReplyModeSchema>;

export const DEFAULT_TTS_MODEL_ID = "eleven_multilingual_v2";

export const voiceSettingsSchema = z.object({
  provider: z.literal("elevenlabs"),
  apiKeyHint: z.string().nullable(),
  hasApiKey: z.boolean(),
  voiceId: z.string().nullable(),
  modelId: z.string(),
  replyMode: voiceReplyModeSchema,
});
export type VoiceSettingsDto = z.infer<typeof voiceSettingsSchema>;

export const saveVoiceSettingsRequestSchema = z
  .object({
    apiKey: z.string().trim().min(8).max(256).optional(),
    voiceId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/, "invalid voice id"),
    modelId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_.-]{1,64}$/, "invalid model id")
      .default(DEFAULT_TTS_MODEL_ID),
    replyMode: voiceReplyModeSchema,
  })
  .strict();
export type SaveVoiceSettingsRequest = z.infer<typeof saveVoiceSettingsRequestSchema>;

export const testVoiceRequestSchema = z
  .object({ text: z.string().trim().min(1).max(200).optional() })
  .strict();

export const testVoiceResultSchema = z.object({
  ok: z.boolean(),
  mimeType: z.string().nullable(),
  /** Base64 audio, short sample only. */
  audioBase64: z.string().nullable(),
  error: z.string().nullable(),
});
export type TestVoiceResult = z.infer<typeof testVoiceResultSchema>;
