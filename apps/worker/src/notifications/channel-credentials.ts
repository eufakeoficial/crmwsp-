import type { NewNotification } from "./notify.js";

/** True when the BSP rejected the channel credentials (HTTP 401/403): retrying can never succeed. */
export function isProviderAuthError(err: unknown): boolean {
  const e = err as { provider?: unknown; status?: unknown } | null;
  return (e?.provider === "gupshup" || e?.provider === "360dialog") && (e.status === 401 || e.status === 403);
}

const BUCKET_MS = 6 * 60 * 60 * 1000;

/** Team notification for a channel whose provider key is invalid; at most one per channel per 6 h bucket. */
export function channelCredentialsNotification(channelId: string, now: Date): NewNotification {
  return {
    kind: "channel_credentials",
    title: "Tu WhatsApp no puede enviar mensajes: la API key de Gupshup no es válida.",
    body: "Ve a Configuración → WhatsApp → Editar credenciales.",
    entity: "channel_connection",
    entityId: channelId,
    dedupeKey: `channel_credentials:${channelId}:${Math.floor(now.getTime() / BUCKET_MS)}`,
  };
}
