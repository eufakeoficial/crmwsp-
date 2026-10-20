import type { AiConnection, KnowledgeSource, OwnerModeStatus, VoiceSettingsDto } from "@crmwsp/contracts";

/** Raw API answers of the hub; `undefined` = unavailable (error or no permission). */
export interface AiHubData {
  connection: AiConnection | null | undefined;
  sources: KnowledgeSource[] | undefined;
  voice: VoiceSettingsDto | undefined;
  owner: OwnerModeStatus | undefined;
}

export type HubFeatureKey = "sources" | "quotes" | "orders" | "voice" | "simulator" | "owner";

/** Whether each hub feature is configured, derived from real API data. */
export function computeHubStatus(d: AiHubData): Record<HubFeatureKey, boolean> {
  const connected = Boolean(d.connection);
  return {
    sources: (d.sources?.length ?? 0) > 0,
    quotes: connected,
    orders: connected,
    voice: Boolean(d.voice?.hasApiKey && d.voice.voiceId),
    simulator: connected,
    owner: d.owner?.phone?.status === "verified",
  };
}
