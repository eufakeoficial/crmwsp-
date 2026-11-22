import type { Transaction } from "@crmwsp/db";
import type { Logger } from "../processors.js";
import { insertNotification, type NewNotification } from "./notify.js";

/** True when the BSP rejected the channel credentials (HTTP 401/403): retrying can never succeed. */
export function authProviderName(err: unknown): string {
  return (err as { provider?: unknown } | null)?.provider === "360dialog" ? "360dialog" : "Gupshup";
}

export function isProviderAuthError(err: unknown): boolean {
  const e = err as { provider?: unknown; status?: unknown } | null;
  return (e?.provider === "gupshup" || e?.provider === "360dialog") && (e.status === 401 || e.status === 403);
}

const BUCKET_MS = 6 * 60 * 60 * 1000;

/** Team notification for a channel whose provider key is invalid; at most one per channel per 6 h bucket. */
export function channelCredentialsNotification(channelId: string, now: Date, provider = "Gupshup"): NewNotification {
  return {
    kind: "channel_credentials",
    title: `Tu WhatsApp no puede enviar mensajes: la API key de ${provider} no es válida.`,
    body: "Ve a Configuración → WhatsApp → Editar credenciales.",
    entity: "channel_connection",
    entityId: channelId,
    dedupeKey: `channel_credentials:${channelId}:${Math.floor(now.getTime() / BUCKET_MS)}`,
  };
}

/**
 * Inserts the alert inside a savepoint so a failing insert (e.g. CHECK rejects the kind before the
 * migration ran) never aborts the caller's send transaction. Logs the error class only.
 */
export async function alertInvalidCredentials(tx: Transaction, tenantId: string, channelId: string, err: unknown, logger: Logger): Promise<void> {
  try {
    await tx.transaction(async (sp) => {
      await insertNotification(sp as Transaction, tenantId, channelCredentialsNotification(channelId, new Date(), authProviderName(err)));
    });
  } catch (notifyErr) {
    logger.warn(`channel credentials alert failed (${(notifyErr as Error)?.name ?? "error"})`);
  }
}
