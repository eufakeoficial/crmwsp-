import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, setActiveTenantId } from "./api";
import { channelsApi, contactsApi, conversationsApi, newClientMessageId } from "./inbox-api";
import { isEncryptionNotConfigured } from "./messages";
import { isOutsideServiceWindow } from "./service-window";

const T = "11111111-1111-4111-8111-111111111111";
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NOW = "2026-10-19T10:00:00.000Z";

const channel = {
  id: ID(1), provider: "gupshup", phoneE164: "+5491155551234", appName: "Demo", status: "active",
  webhookUrl: "http://localhost:4000/webhooks/gupshup/tok", apiKeyHint: "••••abcd", createdAt: NOW, updatedAt: NOW,
};
const conversation = {
  id: ID(2), status: "open", aiMode: "off", channelConnectionId: ID(1),
  contact: { id: ID(3), name: "Juan", phoneE164: "+5491155551234" }, assignee: null, lastMessage: null,
  unreadCount: 1, lastInboundAt: NOW, lastMessageAt: NOW, lastReadAt: null, lockVersion: 4, createdAt: NOW, updatedAt: NOW,
};
const message = {
  id: ID(4), conversationId: ID(2), direction: "outbound", type: "text", body: "hola", status: "queued", author: "user",
  authorUserId: ID(5), clientMessageId: ID(6), error: null, sentAt: null, createdAt: NOW, attachments: [],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setActiveTenantId(T);
});
afterEach(() => vi.unstubAllGlobals());

const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init, body: init.body ? (JSON.parse(init.body as string) as unknown) : undefined };
};

describe("channelsApi", () => {
  it("lists channels with the tenant header", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [channel] })));
    const res = await channelsApi.list();
    expect(res.items[0]?.apiKeyHint).toBe("••••abcd");
    expect(last().url).toBe("/api/channels");
    expect(last().init.headers["x-tenant-id"]).toBe(T);
  });

  it("creates a gupshup channel", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, channel)));
    await channelsApi.createGupshup({ phoneE164: "+5491155551234", appName: "Demo", apiKey: "secret-key-1" });
    expect(last().url).toBe("/api/channels/gupshup");
    expect(last().init.method).toBe("POST");
    expect(last().body).toEqual({ phoneE164: "+5491155551234", appName: "Demo", apiKey: "secret-key-1" });
  });

  it("rotates the token and toggles status", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, channel)));
    await channelsApi.rotateWebhookToken(ID(1));
    expect(last().url).toBe(`/api/channels/${ID(1)}/rotate-webhook-token`);
    await channelsApi.setStatus(ID(1), "disabled");
    expect(last().init.method).toBe("PATCH");
    expect(last().body).toEqual({ status: "disabled" });
  });

  it("surfaces 503 without encryption keys", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(503, { code: "ENCRYPTION_NOT_CONFIGURED", message: "Encryption master keys are not configured" })));
    const err = await channelsApi.list().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 503, code: "ENCRYPTION_NOT_CONFIGURED" });
    expect(isEncryptionNotConfigured(err)).toBe(true);
    // Fallback by status when the body is not JSON (e.g. a proxy page).
    fetchMock.mockImplementation(() => Promise.resolve(new Response("<html>", { status: 503 })));
    expect(isEncryptionNotConfigured(await channelsApi.list().catch((e: unknown) => e))).toBe(true);
  });
});

describe("conversationsApi", () => {
  it("builds the list query and skips empty params", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [conversation], nextCursor: "c1" })));
    const res = await conversationsApi.list({ status: "open", assignedTo: "me", cursor: "abc" });
    expect(res.nextCursor).toBe("c1");
    expect(last().url).toBe("/api/conversations?status=open&assignedTo=me&cursor=abc");
    await conversationsApi.list({});
    expect(last().url).toBe("/api/conversations");
  });

  it("gets detail and pages messages with before", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, conversation)));
    await conversationsApi.get(ID(2));
    expect(last().url).toBe(`/api/conversations/${ID(2)}`);
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [message], nextCursor: null })));
    await conversationsApi.messages(ID(2), { before: "cur", limit: 30 });
    expect(last().url).toBe(`/api/conversations/${ID(2)}/messages?before=cur&limit=30`);
  });

  it("marks as read (204)", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await expect(conversationsApi.markRead(ID(2))).resolves.toBeUndefined();
    expect(last().init.method).toBe("POST");
  });

  it("PATCHes with lockVersion and maps 409", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, conversation)));
    await conversationsApi.update(ID(2), { status: "resolved" }, 4);
    expect(last().body).toEqual({ status: "resolved", lockVersion: 4 });
    fetchMock.mockImplementation(() => Promise.resolve(json(409, { code: "CONFLICT", message: "Conversation was modified" })));
    await expect(conversationsApi.update(ID(2), { assignedUserId: null }, 3)).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
  });

  it("sends with a clientMessageId and accepts 202", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(202, message)));
    const cid = newClientMessageId();
    const res = await conversationsApi.send(ID(2), "hola", cid);
    expect(res.status).toBe("queued");
    expect(last().body).toEqual({ text: "hola", clientMessageId: cid });
    expect(cid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("keeps the OUTSIDE_SERVICE_WINDOW code on 422", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(422, { code: "OUTSIDE_SERVICE_WINDOW", message: "Outside the 24 h service window" })));
    const err = await conversationsApi.send(ID(2), "hola").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 422, code: "OUTSIDE_SERVICE_WINDOW" });
  });
});

describe("contactsApi", () => {
  it("searches contacts", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [{ id: ID(3), name: "Juan", phoneE164: "+54911", tags: ["vip"], extracted: {}, createdAt: NOW, updatedAt: NOW }] })));
    const res = await contactsApi.list({ q: "jua" });
    expect(res.items[0]?.tags).toEqual(["vip"]);
    expect(last().url).toBe("/api/contacts?q=jua");
  });

  it("rejects responses that break the schema", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [{ id: "x" }] })));
    await expect(contactsApi.list()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("isOutsideServiceWindow", () => {
  const now = Date.parse(NOW);
  it("is outside without inbound or after 24 h", () => {
    expect(isOutsideServiceWindow(null, now)).toBe(true);
    expect(isOutsideServiceWindow(new Date(now - 25 * 3600_000).toISOString(), now)).toBe(true);
  });
  it("is inside within 24 h", () => {
    expect(isOutsideServiceWindow(new Date(now - 23 * 3600_000).toISOString(), now)).toBe(false);
  });
});
