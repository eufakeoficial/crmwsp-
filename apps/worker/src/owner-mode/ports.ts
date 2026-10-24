import type { OwnerCommandInterpretation } from "@crmwsp/contracts";
import { ownerCommandResponseFormat, buildOwnerInterpreterMessages, estimateCost, OpenAICompatibleProvider, type LLMProvider } from "@crmwsp/ai";
import { aiMessagesAllowed } from "../ai/plan-gate.js";
import type { CipherBox } from "@crmwsp/crypto";
import { channelConnections, consumeUsage, llmConnections, readPlanUsage, usageLedger, withTenant, type Database } from "@crmwsp/db";
import type { WhatsAppProvider } from "@crmwsp/whatsapp";
import { and, eq } from "drizzle-orm";
import { readBudget } from "../ai/budget.js";
import { LLM_API_KEY_PURPOSE } from "../ai/common.js";
import { GUPSHUP_API_KEY_PURPOSE } from "../outbound.js";
import { isSubscriptionRestricted } from "../subscription-billing/index.js";

/** Sends one owner-mode text to the owner's phone through the tenant channel it wrote to. */
export type OwnerSender = (msg: { tenantId: string; channelConnectionId: string; toE164: string; text: string }) => Promise<void>;

/** Interpreter outcome: `limit` = plan or monthly budget reached (the provider was NOT called). */
export type OwnerInterpretation = { kind: "ok"; value: OwnerCommandInterpretation | null } | { kind: "limit" } | { kind: "no_llm" };

/** Classifies owner text with the tenant's LLM (Structured Outputs), metered like an AI turn. */
export type OwnerInterpreter = (tenantId: string, commandId: string, text: string) => Promise<OwnerInterpretation>;

export function createOwnerSender(deps: { db: Database; provider: WhatsAppProvider; cipher: CipherBox }): OwnerSender {
  return async ({ tenantId, channelConnectionId, toE164, text }) => {
    const conn = await withTenant(deps.db, tenantId, async (tx) => {
      const [c] = await tx
        .select({
          status: channelConnections.status,
          credentials: channelConnections.credentialsEncrypted,
          appName: channelConnections.externalAppId,
          sourcePhone: channelConnections.phoneE164,
          provider: channelConnections.provider,
        })
        .from(channelConnections)
        .where(eq(channelConnections.id, channelConnectionId))
        .limit(1);
      return c;
    });
    if (!conn || conn.status === "disabled" || !conn.credentials || !conn.appName) throw new Error("owner channel unavailable");
    const apiKey = deps.cipher.decrypt(conn.credentials, { tenantId, purpose: GUPSHUP_API_KEY_PURPOSE });
    await deps.provider.sendText({ provider: conn.provider, apiKey, appName: conn.appName, sourcePhone: conn.sourcePhone }, toE164, text.slice(0, 4000));
  };
}

export function createOwnerInterpreter(deps: {
  db: Database;
  cipher: CipherBox;
  logger?: { warn(msg: string): void };
  /** Test seam. */
  buildProvider?: (baseUrl: string, apiKey: string) => LLMProvider;
}): OwnerInterpreter {
  return async (tenantId, commandId, text) => {
    // Spend gates BEFORE the provider call: monthly budget (same rule as AI turns) and plan ai_messages.
    const gate = await withTenant(deps.db, tenantId, async (tx) => {
      const [c] = await tx
        .select()
        .from(llmConnections)
        .where(and(eq(llmConnections.isActive, true), eq(llmConnections.lastTestOk, true)))
        .limit(1);
      if (!c?.apiKeyEncrypted) return { kind: "no_llm" as const };
      const budget = await readBudget(tx, c);
      if (budget.currencyMismatch) deps.logger?.warn("owner-mode: budget currency is not USD; budget not enforced");
      if (budget.exceeded) return { kind: "limit" as const };
      const usage = await readPlanUsage(tx);
      // Admin overrides apply; a subscription restricted past grace (ADR 0013) runs no AI.
      if (await isSubscriptionRestricted(tx)) return { kind: "limit" as const };
      if (!(await aiMessagesAllowed(tx, usage, c))) {
        return { kind: "limit" as const };
      }
      return { kind: "ok" as const, conn: c };
    });
    if (gate.kind !== "ok") return gate;
    const conn = gate.conn;
    if (!conn.apiKeyEncrypted) return { kind: "no_llm" };
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
    const cost = estimateCost(res.model, res.usage);
    await withTenant(deps.db, tenantId, async (tx) => {
      await tx.insert(usageLedger).values({
        tenantId,
        kind: "llm_tokens",
        quantity: String(res.usage.inputTokens + res.usage.outputTokens),
        unit: "tokens",
        costMinor: BigInt(cost.costMinor),
        currency: cost.currency,
        refType: "owner_command",
        refId: commandId,
        meta: {
          model: res.model,
          inputTokens: res.usage.inputTokens,
          outputTokens: res.usage.outputTokens,
          structuredMode: res.structuredMode ?? null,
          verified: cost.verified,
          priceKnown: cost.known,
          unit: "usd_microcents",
        },
      });
      await consumeUsage(tx, tenantId, "ai_messages", 1, null);
    });
    return { kind: "ok", value: res.parsed ?? null };
  };
}
