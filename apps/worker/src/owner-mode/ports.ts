import type { OwnerCommandInterpretation } from "@crmwsp/contracts";
import { ownerCommandResponseFormat, buildOwnerInterpreterMessages, OpenAICompatibleProvider, type LLMProvider } from "@crmwsp/ai";
import type { CipherBox } from "@crmwsp/crypto";
import { channelConnections, llmConnections, withTenant, type Database } from "@crmwsp/db";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { and, eq } from "drizzle-orm";
import { LLM_API_KEY_PURPOSE } from "../ai/common.js";
import { GUPSHUP_API_KEY_PURPOSE } from "../outbound.js";

/** Sends one owner-mode text to the owner's phone through the tenant channel it wrote to. */
export type OwnerSender = (msg: { tenantId: string; channelConnectionId: string; toE164: string; text: string }) => Promise<void>;

/** Classifies owner text with the tenant's LLM (Structured Outputs); null when no usable LLM. */
export type OwnerInterpreter = (tenantId: string, text: string) => Promise<OwnerCommandInterpretation | null>;

export function createOwnerSender(deps: { db: Database; provider: WhatsAppProvider; cipher: CipherBox }): OwnerSender {
  return async ({ tenantId, channelConnectionId, toE164, text }) => {
    const conn = await withTenant(deps.db, tenantId, async (tx) => {
      const [c] = await tx
        .select({
          status: channelConnections.status,
          credentials: channelConnections.credentialsEncrypted,
          appName: channelConnections.externalAppId,
          sourcePhone: channelConnections.phoneE164,
        })
        .from(channelConnections)
        .where(eq(channelConnections.id, channelConnectionId))
        .limit(1);
      return c;
    });
    if (!conn || conn.status === "disabled" || !conn.credentials || !conn.appName) throw new Error("owner channel unavailable");
    const apiKey = deps.cipher.decrypt(conn.credentials, { tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    await deps.provider.sendText({ apiKey, appName: conn.appName, sourcePhone: conn.sourcePhone }, toE164, text.slice(0, 4000));
  };
}

export function createOwnerInterpreter(deps: {
  db: Database;
  cipher: CipherBox;
  /** Test seam. */
  buildProvider?: (baseUrl: string, apiKey: string) => LLMProvider;
}): OwnerInterpreter {
  return async (tenantId, text) => {
    const conn = await withTenant(deps.db, tenantId, async (tx) => {
      const [c] = await tx
        .select()
        .from(llmConnections)
        .where(and(eq(llmConnections.isActive, true), eq(llmConnections.lastTestOk, true)))
        .limit(1);
      return c;
    });
    if (!conn?.apiKeyEncrypted) return null;
    const apiKey = deps.cipher.decrypt(conn.apiKeyEncrypted, { tenantId, purpose: LLM_API_KEY_PURPOSE });
    const provider = deps.buildProvider
      ? deps.buildProvider(conn.baseUrl, apiKey)
      : new OpenAICompatibleProvider({
          baseUrl: conn.baseUrl,
          apiKey,
          ...(conn.capabilities.structuredOutput === false ? { supportsJsonSchema: false } : {}),
        });
    const res = await provider.chat({
      model: conn.modelCheap,
      messages: buildOwnerInterpreterMessages(text),
      responseFormat: ownerCommandResponseFormat,
      temperature: 0,
      maxTokens: 400,
    });
    return res.parsed ?? null;
  };
}
