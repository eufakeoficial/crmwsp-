import { GUPSHUP_PARTNER_TOKEN_PURPOSE } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import { channelConnections, conversations, messages, withTenant, type Database } from "@crmwsp/db";
import { createDefaultWhatsAppProvider, type WhatsAppProvider } from "@crmwsp/whatsapp";
import { and, eq } from "drizzle-orm";
import { GUPSHUP_API_KEY_PURPOSE } from "../outbound.js";
import type { Logger } from "../processors.js";
import { aiMayAutoReply, sessionWindowOpen } from "./turn.js";

/** Everything needed to show "typing..." for one inbound message; encrypted fields are still sealed. */
export interface TypingTarget {
  aiMode: string;
  assignedUserId: string | null;
  status: string;
  lastInboundAt: Date | null;
  inboundExternalId: string | null;
  provider: "gupshup" | "360dialog";
  appName: string | null;
  sourcePhone: string;
  credentials: Buffer | null;
  channelStatus: string;
  partnerAppId: string | null;
  partnerToken: Buffer | null;
}

export interface TypingDeps {
  tenantId: string;
  cipher: Pick<CipherBox, "decrypt">;
  provider: WhatsAppProvider;
  load: () => Promise<TypingTarget | null | undefined>;
  logger?: Logger;
  now: Date;
}

/**
 * Best-effort "typing..." indicator before an automatic AI reply. Never throws: any failure is logged
 * (error class only, no credentials) and swallowed. Skips unless the AI will auto-reply, the 24 h
 * window is open, the inbound has a provider id and the channel has what the BSP needs.
 */
export async function sendTypingIndicator(deps: TypingDeps): Promise<boolean> {
  try {
    const t = await deps.load();
    if (!t || !aiMayAutoReply(t) || !sessionWindowOpen(t.lastInboundAt, deps.now)) return false;
    if (!t.inboundExternalId || !t.credentials || !t.appName || t.channelStatus === "disabled") return false;
    if (!deps.provider.sendTypingIndicator) return false;
    const { tenantId } = deps;
    const apiKey = deps.cipher.decrypt(t.credentials, { tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    const partnerToken = t.partnerToken ? deps.cipher.decrypt(t.partnerToken, { tenantId, purpose: GUPSHUP_PARTNER_TOKEN_PURPOSE }) : undefined;
    await deps.provider.sendTypingIndicator(
      {
        provider: t.provider,
        apiKey,
        appName: t.appName,
        sourcePhone: t.sourcePhone,
        ...(t.partnerAppId ? { partnerAppId: t.partnerAppId } : {}),
        ...(partnerToken ? { partnerToken } : {}),
      },
      t.inboundExternalId,
    );
    return true;
  } catch (err) {
    deps.logger?.warn(`typing indicator failed (${err instanceof Error ? err.name : "unknown"})`);
    return false;
  }
}

/** Loads the target through RLS-scoped queries (one short transaction). */
function loadTarget(db: Database, tenantId: string, conversationId: string, triggerMessageId: string) {
  return async (): Promise<TypingTarget | undefined> =>
    withTenant(db, tenantId, async (tx) => {
      const [row] = await tx
        .select({
          aiMode: conversations.aiMode,
          assignedUserId: conversations.assignedUserId,
          status: conversations.status,
          lastInboundAt: conversations.lastInboundAt,
          inboundExternalId: messages.externalId,
          provider: channelConnections.provider,
          appName: channelConnections.externalAppId,
          sourcePhone: channelConnections.phoneE164,
          credentials: channelConnections.credentialsEncrypted,
          channelStatus: channelConnections.status,
          partnerAppId: channelConnections.gupshupAppId,
          partnerToken: channelConnections.partnerTokenEncrypted,
        })
        .from(conversations)
        .innerJoin(channelConnections, eq(channelConnections.id, conversations.channelConnectionId))
        .innerJoin(messages, and(eq(messages.id, triggerMessageId), eq(messages.conversationId, conversations.id)))
        .where(eq(conversations.id, conversationId))
        .limit(1);
      return row as TypingTarget | undefined;
    });
}

/** Fire-and-forget entry used by the AI turn: returns immediately, never rejects. */
export function startTypingIndicator(
  deps: { db: Database; cipher: CipherBox; whatsapp?: WhatsAppProvider; logger?: Logger },
  c: { tenantId: string; conversationId: string; triggerMessageId: string; now: Date },
): void {
  void sendTypingIndicator({
    tenantId: c.tenantId,
    cipher: deps.cipher,
    provider: deps.whatsapp ?? defaultProvider(),
    load: loadTarget(deps.db, c.tenantId, c.conversationId, c.triggerMessageId),
    now: c.now,
    ...(deps.logger ? { logger: deps.logger } : {}),
  });
}

let cached: WhatsAppProvider | undefined;
function defaultProvider(): WhatsAppProvider {
  return (cached ??= createDefaultWhatsAppProvider());
}
