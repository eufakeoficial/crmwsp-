import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

export const SECRET_KEY = "sk_test_51SuperSecretKeyValue1234567890";
export const WEBHOOK_SECRET = "whsec_TopSecretWebhookValue0987654321";
export const NOW_S = 1760918500; // 100 s after the fixtures' `created`
export const nowMs = () => NOW_S * 1000;

export function fixtureText(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8");
}
export function fixture(name: string): Record<string, unknown> {
  return JSON.parse(fixtureText(name)) as Record<string, unknown>;
}
export const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

export function sign(body: string, t = NOW_S, secret = WEBHOOK_SECRET): string {
  return createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
}
export function header(body: string, t = NOW_S, secret = WEBHOOK_SECRET): { "stripe-signature": string } {
  return { "stripe-signature": `t=${t},v1=${sign(body, t, secret)}` };
}

export interface Call {
  url: string;
  init: RequestInit;
}
export function mockFetch(responses: Array<Response | Error>): { fetch: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = responses[Math.min(i++, responses.length - 1)]!;
    if (r instanceof Error) throw r;
    // Fresh, non-tee'd body per call (cancelling a cloned stream would hang).
    return new Response(await r.clone().text(), { status: r.status, headers: r.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}
export const json = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "application/json" } });
