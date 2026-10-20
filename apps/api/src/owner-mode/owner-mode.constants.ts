import { EncryptionNotConfiguredError, ExternalProviderError, ValidationError } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { channelConnections, eq } from "@crmwsp/db";
import { GupshupProvider, type WhatsAppProvider } from "@crmwsp/whatsapp";
import { GUPSHUP_API_KEY_PURPOSE } from "../channels/channels.constants.js";
import type { TenantDb } from "../db/tenant-db.js";

export const OWNER_CODE_SENDER = Symbol("OWNER_CODE_SENDER");

/** Sends the 6-digit verification code to the owner's phone through the tenant channel. */
export type OwnerCodeSender = (msg: { db: TenantDb; channelConnectionId: string; toE164: string; code: string }) => Promise<void>;

export function ownerCodeText(code: string): string {
  return `Tu código para activar el modo dueño es ${code}. Caduca en 10 minutos. Si no lo pediste, ignora este mensaje.`;
}

export function createOwnerCodeSender(cipher: CipherBox | null, provider: WhatsAppProvider = new GupshupProvider()): OwnerCodeSender {
  return async ({ db, channelConnectionId, toE164, code }) => {
    if (!cipher) throw new EncryptionNotConfiguredError();
    const conn = await db.run(async (tx) => {
      const [c] = await tx
        .select({ credentials: channelConnections.credentialsEncrypted, appName: channelConnections.externalAppId, sourcePhone: channelConnections.phoneE164 })
        .from(channelConnections)
        .where(eq(channelConnections.id, channelConnectionId))
        .limit(1);
      return c;
    });
    if (!conn?.credentials || !conn.appName) throw new ValidationError("WhatsApp channel has no credentials");
    const apiKey = cipher.decrypt(conn.credentials, { tenantId: db.tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    try {
      await provider.sendText({ apiKey, appName: conn.appName, sourcePhone: conn.sourcePhone }, toE164, ownerCodeText(code));
    } catch {
      // Provider errors may echo the request; never propagate them (the code is in the body).
      throw new ExternalProviderError("gupshup", "Could not send the verification code");
    }
  };
}
