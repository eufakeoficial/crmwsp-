import { test as base, expect, type Page, type Route } from "@playwright/test";

/**
 * Auth + API mocking for the E2E suite.
 *
 * Gating in the app has two layers:
 *  1. middleware.ts only checks that the `__Host-crmwsp_session` cookie EXISTS for /app/* (the API does
 *     the real validation), so we plant a dummy cookie.
 *  2. SessionProvider calls GET /api/auth/me and redirects to /login on 401, so we mock it.
 * Everything under /api/** is fulfilled here; nothing reaches a backend, Gupshup or production.
 */

export const TENANT_ID = "11111111-1111-4111-8111-111111111111";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const CHANNEL_ID = "33333333-3333-4333-8333-333333333333";
export const CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
export const CONTACT_ID = "55555555-5555-4555-8555-555555555555";
export const WEBHOOK_TOKEN = "tok_e2e_0123456789";
export const WEBHOOK_URL = `https://api.example.test/webhooks/gupshup/${WEBHOOK_TOKEN}`;
const NOW = "2026-01-15T12:00:00.000Z";

export function channelFixture(over: Record<string, unknown> = {}) {
  return {
    id: CHANNEL_ID,
    provider: "gupshup",
    phoneE164: "+5491155551234",
    appName: "MiEmpresaApp",
    status: "active",
    webhookUrl: WEBHOOK_URL,
    apiKeyHint: "••••1234",
    partnerConfigured: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

export function conversationFixture(aiMode: "off" | "assist" | "auto" = "assist") {
  return {
    id: CONVERSATION_ID,
    status: "open",
    aiMode,
    channelConnectionId: CHANNEL_ID,
    contact: { id: CONTACT_ID, name: "Cliente Prueba", phoneE164: "+5491166667777" },
    assignee: null,
    lastMessage: { id: "66666666-6666-4666-8666-666666666666", direction: "inbound", type: "text", status: "delivered", preview: "Hola", createdAt: NOW },
    unreadCount: 0,
    lastInboundAt: NOW,
    lastMessageAt: NOW,
    lastReadAt: NOW,
    lockVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    inboxStatus: "open",
    unread: false,
    markedUnread: false,
    assignedAt: null,
    closedAt: null,
    contactTags: [],
    automationsPausedUntil: null,
    nextReminderAt: null,
  };
}

export interface RecordedRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (req: RecordedRequest) => { status?: number; json?: unknown };

export interface ApiMock {
  /** Registers a handler for `METHOD /path` (path relative to /api, no query). Last registration wins. */
  on(method: string, path: string, handler: Handler): void;
  /** Every request that reached the mock, in order. */
  requests: RecordedRequest[];
  /** Requests nobody handled (answered 404 so the test notices instead of hanging). */
  unhandled: string[];
}

const respond = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

async function installApiMock(page: Page): Promise<ApiMock> {
  const handlers = new Map<string, Handler>();
  const mock: ApiMock = {
    on: (method, path, handler) => void handlers.set(`${method.toUpperCase()} ${path}`, handler),
    requests: [],
    unhandled: [],
  };

  mock.on("GET", "/auth/me", () => ({
    json: {
      user: { id: USER_ID, email: "owner@example.test", name: "Dueña E2E", emailVerified: true },
      tenants: [{ id: TENANT_ID, slug: "e2e", name: "Negocio E2E", role: "owner", status: "active" }],
    },
  }));

  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, "");
    const method = req.method();
    let body: unknown = null;
    try {
      body = req.postDataJSON();
    } catch {
      body = null;
    }
    mock.requests.push({ method, path, headers: req.headers(), body });
    const handler = handlers.get(`${method} ${path}`);
    if (!handler) {
      mock.unhandled.push(`${method} ${path}`);
      return respond(route, 404, { code: "NOT_FOUND", message: "not mocked" });
    }
    const out = handler(mock.requests[mock.requests.length - 1]!);
    return respond(route, out.status ?? 200, out.json ?? {});
  });
  return mock;
}

export const test = base.extend<{ api: ApiMock }>({
  api: async ({ page }, use) => {
    const api = await installApiMock(page);
    // Plants the session cookie the middleware looks for (Chrome accepts Secure cookies on localhost).
    await page.context().addCookies([{ name: "__Host-crmwsp_session", value: "e2e", domain: "localhost", path: "/", secure: true }]);
    await use(api);
  },
});

export { expect };
