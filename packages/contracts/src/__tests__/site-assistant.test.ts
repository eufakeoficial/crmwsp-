import { describe, expect, it } from "vitest";
import { siteAssistantRequestSchema, siteAssistantResponseSchema } from "../site-assistant.js";

const user = (content: string) => ({ role: "user" as const, content });

describe("site assistant contracts", () => {
  it("accepts 1..12 messages ending with the user", () => {
    expect(siteAssistantRequestSchema.safeParse({ messages: [user("hola")] }).success).toBe(true);
    const twelve = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "x" }));
    twelve[11] = user("ok");
    expect(siteAssistantRequestSchema.safeParse({ messages: twelve }).success).toBe(true);
  });

  it("rejects empty, too many, too long, bad role, trailing assistant and extra keys", () => {
    expect(siteAssistantRequestSchema.safeParse({ messages: [] }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: Array.from({ length: 13 }, () => user("a")) }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: [user("a".repeat(501))] }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: [user("   ")] }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: [{ role: "system", content: "x" }] }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: [user("a"), { role: "assistant", content: "b" }] }).success).toBe(false);
    expect(siteAssistantRequestSchema.safeParse({ messages: [user("a")], model: "gpt-5" }).success).toBe(false);
  });

  it("only allows closed action kinds and safe hrefs", () => {
    const ok = { reply: "Hola", action: { kind: "signup", label: "Crear cuenta", href: "/signup" }, source: "ai" };
    expect(siteAssistantResponseSchema.safeParse(ok).success).toBe(true);
    expect(siteAssistantResponseSchema.safeParse({ ...ok, action: { ...ok.action, href: "https://wa.me/5491112345678?text=Hola" } }).success).toBe(true);
    expect(siteAssistantResponseSchema.safeParse({ ...ok, action: { ...ok.action, kind: "external" } }).success).toBe(false);
    for (const href of ["https://evil.com", "//evil.com", "javascript:alert(1)", "https://wa.me.evil.com/1"]) {
      expect(siteAssistantResponseSchema.safeParse({ ...ok, action: { ...ok.action, href } }).success, href).toBe(false);
    }
    expect(siteAssistantResponseSchema.safeParse({ ...ok, reply: "a".repeat(601) }).success).toBe(false);
    expect(siteAssistantResponseSchema.safeParse({ ...ok, action: null, source: "local" }).success).toBe(true);
  });
});
