import { request } from "./api";
import {
  type SaveVoiceSettingsRequest,
  type TestVoiceResult,
  type VoiceSettingsDto,
  testVoiceResultSchema,
  voiceSettingsSchema,
} from "@crmwsp/contracts";

export type SaveVoiceInput = Omit<SaveVoiceSettingsRequest, "apiKey" | "modelId"> & { apiKey?: string; modelId?: string };

export const voiceApi = {
  get: (): Promise<VoiceSettingsDto> => request("/ai/voice", { schema: voiceSettingsSchema }),
  save: (input: SaveVoiceInput): Promise<VoiceSettingsDto> => request("/ai/voice", { method: "PUT", body: input, schema: voiceSettingsSchema }),
  test: (text?: string): Promise<TestVoiceResult> =>
    request("/ai/voice/test", { method: "POST", body: text ? { text } : {}, schema: testVoiceResultSchema }),
};
