import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { OpenAICompatibleProvider, type LLMProvider } from "@crmwsp/ai";
import { SITE_ASSISTANT_MAX_REPLY, siteAssistantActionKindSchema, type SiteAssistantActionKind, type SiteAssistantRequest, type SiteAssistantResponse } from "@crmwsp/contracts";
import { z } from "zod";
import { RATE_LIMIT_STORE, type CounterStore, defaultRateLimitStore } from "../common/rate-limit-store.js";
import { fallbackReply } from "./fallback.js";
import { REPLY_JSON_SCHEMA, buildSystemPrompt, resolveAction, salesWhatsappFromEnv } from "./knowledge.js";

export const SITE_ASSISTANT_LLM = Symbol("SITE_ASSISTANT_LLM");
export const SITE_ASSISTANT_CONFIG = Symbol("SITE_ASSISTANT_CONFIG");

export interface SiteAssistantConfig {
  model: string;
  dailyCap: number;
  timeoutMs: number;
  breakerMs: number;
  whatsapp: string | null;
}

export function siteAssistantConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SiteAssistantConfig {
  const cap = Number(env["SITE_ASSISTANT_DAILY_CAP"] ?? 2000);
  return {
    model: env["SITE_ASSISTANT_MODEL"]?.trim() || "gpt-4o-mini",
    dailyCap: Number.isFinite(cap) && cap >= 0 ? Math.floor(cap) : 2000,
    timeoutMs: 12_000,
    breakerMs: 2 * 60_000,
    whatsapp: salesWhatsappFromEnv(env),
  };
}

/** Platform-owned key (never a tenant's BYOK). Null when unset: the assistant answers from the fallback only. */
export function siteAssistantLlmFromEnv(env: NodeJS.ProcessEnv = process.env): LLMProvider | null {
  const apiKey = env["SITE_ASSISTANT_API_KEY"]?.trim();
  if (!apiKey) return null;
  return new OpenAICompatibleProvider({
    apiKey,
    baseUrl: env["SITE_ASSISTANT_BASE_URL"]?.trim() || "https://api.openai.com/v1",
    timeoutMs: 12_000,
    maxResponseBytes: 64 * 1024,
    production: env["NODE_ENV"] === "production",
  });
}

const llmReplySchema = z.object({ reply: z.string().trim().min(1), action: siteAssistantActionKindSchema.nullable() });

const DAY_MS = 24 * 60 * 60 * 1000;

/** Collapses whitespace and strips markdown-ish markers; caps to the contract length. */
export function cleanReply(text: string): string {
  const t = text.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim();
  return t.length <= SITE_ASSISTANT_MAX_REPLY ? t : `${t.slice(0, SITE_ASSISTANT_MAX_REPLY - 1).trimEnd()}…`;
}

@Injectable()
export class SiteAssistantService {
  private readonly logger = new Logger("SiteAssistant");
  private readonly store: CounterStore;
  private breakerUntil = 0;
  /** Clock, overridable in tests. */
  now: () => number = Date.now;
  private readonly system = buildSystemPrompt();

  constructor(
    @Inject(SITE_ASSISTANT_CONFIG) private readonly config: SiteAssistantConfig,
    @Optional() @Inject(SITE_ASSISTANT_LLM) private readonly llm: LLMProvider | null = null,
    @Optional() @Inject(RATE_LIMIT_STORE) store?: CounterStore,
  ) {
    this.store = store ?? defaultRateLimitStore();
  }

  async answer(req: SiteAssistantRequest): Promise<SiteAssistantResponse> {
    const last = req.messages[req.messages.length - 1]?.content ?? "";
    if (this.llm && this.now() >= this.breakerUntil && (await this.underDailyCap())) {
      try {
        const res = await this.withTimeout(
          this.llm.chat({
            model: this.config.model,
            temperature: 0.3,
            maxTokens: 300,
            messages: [{ role: "system", content: this.system }, ...req.messages.map((m) => ({ role: m.role, content: m.content }))],
            responseFormat: { name: "site_assistant_reply", jsonSchema: REPLY_JSON_SCHEMA, schema: llmReplySchema },
          }),
        );
        const parsed = llmReplySchema.safeParse(res.parsed);
        if (parsed.success) {
          const reply = cleanReply(parsed.data.reply);
          if (reply) return { reply, action: this.action(parsed.data.action), source: "ai" };
        }
        this.logger.warn({ event: "site_assistant.invalid_output" });
      } catch (err) {
        // Error name only: never the message content, the key or the provider body.
        this.breakerUntil = this.now() + this.config.breakerMs;
        this.logger.warn({ event: "site_assistant.provider_failed", error: (err as Error)?.name ?? "Error" });
      }
    }
    const fb = fallbackReply(last);
    return { reply: fb.reply, action: this.action(fb.action), source: "local" };
  }

  private action(kind: SiteAssistantActionKind | null) {
    // Without a sales number, "talk to us" degrades to signup.
    return resolveAction(kind === "whatsapp" && !this.config.whatsapp ? "signup" : kind, this.config.whatsapp);
  }

  /** Global daily budget of LLM calls (counted before calling, so failures also spend it). */
  private async underDailyCap(): Promise<boolean> {
    if (this.config.dailyCap <= 0) return false;
    const day = new Date(this.now()).toISOString().slice(0, 10);
    try {
      const n = await this.store.incr(`sa:cap:${day}`, DAY_MS);
      if (n === this.config.dailyCap + 1) this.logger.warn({ event: "site_assistant.daily_cap_reached" });
      return n <= this.config.dailyCap;
    } catch {
      return false;
    }
  }

  private withTimeout<T>(p: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" })), this.config.timeoutMs);
    });
    return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
  }
}
