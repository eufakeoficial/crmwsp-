import "reflect-metadata";
import type { ChatRequest, ChatResult, LLMProvider } from "@crmwsp/ai";
import { RateLimitedError, ValidationError, siteAssistantResponseSchema } from "@crmwsp/contracts";
import { describe, expect, it, vi } from "vitest";
import type { HttpRequest } from "../../common/http.js";
import { MemoryCounterStore } from "../../common/rate-limit-store.js";
import { fallbackReply } from "../fallback.js";
import { buildSystemPrompt } from "../knowledge.js";
import { PublicAssistantController, type SiteAssistantRateLimits } from "../public-assistant.controller.js";
import { SiteAssistantService, cleanReply, type SiteAssistantConfig } from "../site-assistant.service.js";

const cfg = (over: Partial<SiteAssistantConfig> = {}): SiteAssistantConfig => ({ model: "m", dailyCap: 100, timeoutMs: 50, breakerMs: 120_000, whatsapp: "5491112345678", ...over });
const limits: SiteAssistantRateLimits = { perMinute: { limit: 10, windowMs: 60_000 }, perDay: { limit: 60, windowMs: 86_400_000 } };
const req = (ip = "1.2.3.4", headers: Record<string, string> = {}) => ({ ip, headers, method: "POST" }) as unknown as HttpRequest;
const body = (content = "hola") => ({ messages: [{ role: "user", content }] });

function fakeLlm(impl: (r: ChatRequest) => Promise<Partial<ChatResult>>) {
  const chat = vi.fn(impl);
  return { llm: { name: "fake", chat, embed: vi.fn(), transcribe: vi.fn(), testConnection: vi.fn() } as unknown as LLMProvider, chat };
}

const ok = (reply: string, action: string | null = "signup") => async () => ({ parsed: { reply, action } });

function setup(llm: LLMProvider | null, over: Partial<SiteAssistantConfig> = {}, lim = limits) {
  const store = new MemoryCounterStore();
  const service = new SiteAssistantService(cfg(over), llm, store);
  return { service, controller: new PublicAssistantController(service, lim, store) };
}

describe("fallback router", () => {
  it.each([
    ["¿Cómo funciona con mi WhatsApp?", "how_it_works"],
    ["¿La IA puede inventar precios?", "faq"],
    ["¿Cómo cobro a mis clientes?", "how_it_works"],
    ["Quiero una demo", "whatsapp"],
    ["¿Cuánto cuesta?", "pricing"],
    ["Quiero crear una cuenta", "signup"],
    ["asdfgh", "faq"],
  ])("%s -> %s", (q, action) => {
    const r = fallbackReply(q);
    expect(r.action).toBe(action);
    expect(r.reply).not.toMatch(/\$|\d+ ?%|USD/);
  });
});

describe("knowledge prompt", () => {
  it("includes landing content and the injection rule", () => {
    const p = buildSystemPrompt();
    expect(p).toContain("CONOCIMIENTO");
    expect(p).toContain("¿Qué es BYOK");
    expect(p).toMatch(/Nunca inventes precios/);
    expect(p).toMatch(/no instrucciones/);
  });
  it("cleanReply strips markdown and caps length", () => {
    expect(cleanReply("**Hola**\n\n `x`")).toBe("Hola x");
    expect(cleanReply("a".repeat(700))).toHaveLength(600);
  });
});

describe("PublicAssistantController", () => {
  it("answers with the AI, structured output and closed action", async () => {
    const { llm, chat } = fakeLlm(ok("Hola, soy el asistente."));
    const { controller } = setup(llm);
    const res = await controller.ask(body(), req());
    expect(siteAssistantResponseSchema.parse(res)).toEqual({ reply: "Hola, soy el asistente.", action: { kind: "signup", label: "Crear cuenta gratis", href: "/signup" }, source: "ai" });
    const sent = chat.mock.calls[0]![0];
    expect(sent.responseFormat?.name).toBe("site_assistant_reply");
    expect(sent.messages[0]!.role).toBe("system");
    expect(sent.messages).toHaveLength(2);
  });

  it("uses the fallback without a provider", async () => {
    const { controller } = setup(null);
    const res = await controller.ask(body("Quiero una demo"), req());
    expect(res.source).toBe("local");
    expect(res.action?.href).toMatch(/^https:\/\/wa\.me\/5491112345678/);
  });

  it("degrades whatsapp to signup when no sales number is configured", async () => {
    const { controller } = setup(null, { whatsapp: null });
    expect((await controller.ask(body("Quiero una demo"), req())).action?.kind).toBe("signup");
  });

  it("falls back on provider failure and opens the breaker for 2 minutes", async () => {
    const { llm, chat } = fakeLlm(async () => {
      throw new Error("boom");
    });
    const { controller, service } = setup(llm);
    let t = 1_000_000;
    service.now = () => t;
    expect((await controller.ask(body(), req())).source).toBe("local");
    expect((await controller.ask(body(), req())).source).toBe("local");
    expect(chat).toHaveBeenCalledTimes(1);
    t += 120_001;
    await controller.ask(body(), req());
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("falls back on timeout and on invalid model output", async () => {
    const slow = fakeLlm(() => new Promise(() => undefined));
    expect((await setup(slow.llm).controller.ask(body(), req())).source).toBe("local");
    const bad = fakeLlm(async () => ({ parsed: { reply: "", action: "hack" } }));
    expect((await setup(bad.llm).controller.ask(body(), req())).source).toBe("local");
  });

  it("stops calling the LLM once the global daily cap is reached", async () => {
    const { llm, chat } = fakeLlm(ok("Hola", null));
    const { controller } = setup(llm, { dailyCap: 2 });
    const sources = [];
    for (let i = 0; i < 4; i++) sources.push((await controller.ask(body(), req(`10.0.0.${i}`))).source);
    expect(sources).toEqual(["ai", "ai", "local", "local"]);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("rate limits per IP per minute and per day", async () => {
    const { controller } = setup(null, {}, { perMinute: { limit: 2, windowMs: 60_000 }, perDay: { limit: 3, windowMs: 86_400_000 } });
    await controller.ask(body(), req("9.9.9.9"));
    await controller.ask(body(), req("9.9.9.9"));
    await expect(controller.ask(body(), req("9.9.9.9"))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(controller.ask(body(), req("8.8.8.8"))).resolves.toBeTruthy();
    const day = setup(null, {}, { perMinute: { limit: 100, windowMs: 60_000 }, perDay: { limit: 2, windowMs: 86_400_000 } }).controller;
    await day.ask(body(), req());
    await day.ask(body(), req());
    await expect(day.ask(body(), req())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("rejects invalid bodies and oversized requests", async () => {
    const { controller } = setup(null);
    await expect(controller.ask({ messages: [] }, req())).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.ask(body("x".repeat(501)), req())).rejects.toBeInstanceOf(ValidationError);
    await expect(controller.ask(body(), req("1.1.1.1", { "content-length": "999999" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("never logs message content", async () => {
    const warn = vi.spyOn((await import("@nestjs/common")).Logger.prototype, "warn").mockImplementation(() => undefined);
    const { llm } = fakeLlm(async () => {
      throw new Error("secret-body");
    });
    await setup(llm).controller.ask(body("mi-dato-privado"), req());
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/mi-dato-privado|secret-body/);
    warn.mockRestore();
  });
});
