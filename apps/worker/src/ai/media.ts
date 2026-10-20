import { channelConnections, conversations, withTenant, type Database } from "@crmwsp/db";
import type { CipherBox } from "@crmwsp/crypto";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { eq } from "drizzle-orm";
import { GUPSHUP_API_KEY_PURPOSE } from "../outbound.js";
import type { MediaLoader } from "./transcribe.js";

/**
 * Builds the production `MediaLoader`: finds the conversation's channel (RLS-scoped), decrypts the
 * BSP key and downloads the media through the `WhatsAppProvider`. Wire it as `AiDeps.loadMedia`.
 * Media is not persisted to object storage yet (processors.ts TODO), so audio is fetched on demand.
 */
export function createBspMediaLoader(deps: { db: Database; cipher: CipherBox; provider: WhatsAppProvider }): MediaLoader {
  return async ({ tenantId, conversationId, externalMediaId, mimeType }) => {
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
