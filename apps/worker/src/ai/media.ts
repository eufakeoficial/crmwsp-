import { attachments, channelConnections, conversations, messages, withTenant, type Database } from "@crmwsp/db";
import type { CipherBox } from "@crmwsp/crypto";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { and, eq, isNotNull } from "drizzle-orm";
import { GUPSHUP_API_KEY_PURPOSE } from "../outbound.js";
import type { MediaStore } from "../media/store.js";
import type { MediaLoader } from "./transcribe.js";

/**
 * Builds the production `MediaLoader`: finds the conversation's channel (RLS-scoped), decrypts the
 * BSP key and downloads the media through the `WhatsAppProvider`. Wire it as `AiDeps.loadMedia`.
 * When a `store` is given and the attachment was already copied to object storage (storage_key set),
 * the bytes are read from there; any storage miss or error falls back to the BSP download.
 */
export function createBspMediaLoader(deps: {
  db: Database;
  cipher: CipherBox;
  provider: WhatsAppProvider;
  store?: MediaStore | null;
}): MediaLoader {
  return async ({ tenantId, conversationId, externalMediaId, mimeType }) => {
    if (deps.store) {
      const stored = await withTenant(deps.db, tenantId, async (tx) => {
        const [row] = await tx
          .select({ storageKey: attachments.storageKey, mimeType: attachments.mimeType })
          .from(attachments)
          .innerJoin(messages, eq(messages.id, attachments.messageId))
          .where(
            and(
              eq(messages.conversationId, conversationId),
              eq(attachments.externalMediaId, externalMediaId),
              isNotNull(attachments.storageKey),
            ),
          )
          .limit(1);
        return row;
      }).catch(() => undefined);
      if (stored?.storageKey) {
        try {
          const obj = await deps.store.get(stored.storageKey);
          return { data: obj.data, mimeType: obj.contentType ?? stored.mimeType ?? mimeType ?? "application/octet-stream" };
        } catch {
          // fall through to the BSP
        }
      }
    }
    const ch = await withTenant(deps.db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          sourcePhone: channelConnections.phoneE164,
          appName: channelConnections.externalAppId,
          credentials: channelConnections.credentialsEncrypted,
          status: channelConnections.status,
        })
        .from(conversations)
        .innerJoin(channelConnections, eq(channelConnections.id, conversations.channelConnectionId))
        .where(eq(conversations.id, conversationId))
        .limit(1);
      return row;
    });
    if (!ch || ch.status === "disabled" || !ch.credentials || !ch.appName) throw new Error("channel unavailable");
    const apiKey = deps.cipher.decrypt(ch.credentials, { tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    // BSP inbound media is addressed by URL (see processors.ts: externalMediaId ?? url).
    return deps.provider.downloadMedia(
      { apiKey, appName: ch.appName, sourcePhone: ch.sourcePhone },
      { url: externalMediaId, externalMediaId, ...(mimeType ? { mimeType } : {}) },
    );
  };
}
