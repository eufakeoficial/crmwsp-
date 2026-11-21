import { LlmProviderError } from "@crmwsp/ai";
import type { LlmConnection } from "@crmwsp/db";
import type { NewNotification } from "../notifications/notify.js";

const PROVIDER_LABEL: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
};

/** True when the tenant's own AI key failed because it has no balance/quota left. */
export function isInsufficientQuota(err: unknown): boolean {
  return err instanceof LlmProviderError && err.reason === "insufficient_quota";
}

/**
 * Team notification for a BYOK key that ran out of balance. One per connection per UTC day, so a busy
 * inbox does not flood the bell. Contains no provider response, key or customer text.
 */
export function quotaNotification(conn: Pick<LlmConnection, "id" | "provider">, now: Date): NewNotification {
  const label = PROVIDER_LABEL[conn.provider] ?? "de IA";
  return {
    kind: "ai_credentials",
    title: conn.provider in PROVIDER_LABEL ? `Tu clave de ${label} se quedó sin saldo` : "Tu clave de IA se quedó sin saldo",
    body: "La IA dejó de responder y pasó las conversaciones a una persona. Recarga el saldo en tu proveedor de IA y vuelve a probar la conexión en Ajustes › IA.",
    entity: "llm_connection",
    entityId: conn.id,
    dedupeKey: `ai_quota:${conn.id}:${now.toISOString().slice(0, 10)}`,
  };
}
