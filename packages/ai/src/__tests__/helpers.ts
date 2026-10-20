import { vi } from "vitest";

export const API_KEY = "sk-SUPERSECRET-byok-key-123";
export const publicLookup = async () => [{ address: "93.184.216.34" }];

export type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;
export function mockFetch(...handlers: Handler[]) {
  let i = 0;
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const h = handlers[Math.min(i++, handlers.length - 1)]!;
    return h(String(url), init ?? {});
  });
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
export const chatBody = (content: string, extra: Record<string, unknown> = {}) => ({
  model: "gpt-5-mini-2025-08-07",
  choices: [{ message: { content }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5 },
  ...extra,
});
