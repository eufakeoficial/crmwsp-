import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realAiApi, realKnowledgeApi } from "./ai-api";
import { setActiveTenantId } from "./api";
import { budgetLevel, budgetPercent, toMinor, validateBaseUrl } from "./ai-validation";
import { canManageAi, canViewAi } from "../components/app/roles";

const T = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-10-19T10:00:00.000Z";
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const connection = {
  provider: "openai", baseUrl: "https://api.openai.com/v1", apiKeyHint: "••••wxyz", modelCheap: "gpt-4o-mini", modelStrong: "gpt-4o",
  capabilities: { structuredOutput: true, embeddings: true, transcription: false }, lastTestedAt: NOW, lastTestOk: true,
  monthlyBudgetMinor: 2000, budgetCurrency: "EUR",
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setActiveTenantId(T);
});
afterEach(() => vi.unstubAllGlobals());

const last = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init, body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : init.body };
};

describe("aiApi", () => {
  it("reads the connection (null when absent) with the tenant header", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, null)));
    expect(await realAiApi.getConnection()).toBeNull();
    expect(last().url).toBe("/api/ai/connection");
    expect(last().init.headers["x-tenant-id"]).toBe(T);
    fetchMock.mockImplementation(() => Promise.resolve(json(200, connection)));
    expect((await realAiApi.getConnection())?.apiKeyHint).toBe("••••wxyz");
  });

  it("PUTs the connection and omits apiKey when not given", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, connection)));
    await realAiApi.saveConnection({ provider: "openai", modelCheap: "a", modelStrong: "b" });
    expect(last().init.method).toBe("PUT");
    expect(last().body).toEqual({ provider: "openai", modelCheap: "a", modelStrong: "b" });
  });

  it("tests and deletes the connection", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { ok: true, latencyMs: 300, capabilities: connection.capabilities })));
    expect((await realAiApi.testConnection()).latencyMs).toBe(300);
    expect(last().url).toBe("/api/ai/connection/test");
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await realAiApi.deleteConnection();
    expect(last().init.method).toBe("DELETE");
  });

  it("queries usage by month and rejects malformed responses", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { spentMinor: 10, currency: "EUR", budgetMinor: null, currencyMismatch: false, estimated: false, byKind: [] })));
    await realAiApi.usage("2026-10");
    expect(last().url).toBe("/api/ai/usage?month=2026-10");
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { spentMinor: "x" })));
    await expect(realAiApi.usage("2026-10")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("lists pending actions and posts decisions with an optional note", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [] })));
    await realAiApi.listActions();
    expect(last().url).toBe("/api/ai/actions?status=pending_approval");
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await realAiApi.approveAction("a1", "  ok ");
    expect(last().url).toBe("/api/ai/actions/a1/approve");
    expect(last().body).toEqual({ note: "ok" });
    await realAiApi.rejectAction("a1");
    expect(last().body).toEqual({});
  });
});

describe("knowledgeApi", () => {
  const source = { id: "s1", kind: "csv", title: "p.csv", status: "ready", version: 1, chunkCount: 3, updatedAt: NOW };

  it("uploads files as multipart without a JSON content-type", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, source)));
    await realKnowledgeApi.createSource({ kind: "csv", file: new File(["a,b"], "p.csv") });
    expect(last().body).toBeInstanceOf(FormData);
    expect(last().init.headers["content-type"]).toBeUndefined();
    expect((last().body as FormData).get("kind")).toBe("csv");
  });

  it("sends faq/text as JSON, lists, deletes and lists conflicts", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, source)));
    await realKnowledgeApi.createSource({ kind: "faq", title: "FAQ", content: "Q: A" });
    expect(last().body).toEqual({ kind: "faq", title: "FAQ", content: "Q: A" });
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [source] })));
    expect(await realKnowledgeApi.listSources()).toHaveLength(1);
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { items: [{ key: "x", sources: [{ sourceId: "s1", title: "t", priceMinor: 100, currency: "EUR" }] }] })));
    expect((await realKnowledgeApi.conflicts())[0]?.key).toBe("x");
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    await realKnowledgeApi.deleteSource("s1");
    expect(last().url).toBe("/api/knowledge/sources/s1");
    expect(last().init.method).toBe("DELETE");
  });
});

describe("API key handling", () => {
  it("never touches browser storage when saving", async () => {
    const storage = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("sessionStorage", storage);
    fetchMock.mockImplementation(() => Promise.resolve(json(200, connection)));
    await realAiApi.saveConnection({ provider: "openai", apiKey: "sk-secret-123456", modelCheap: "a", modelStrong: "b" });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("does not reference web storage in the AI code", () => {
    const dir = join(__dirname, "../components/ai");
    const files = readdirSync(dir).map((f) => join(dir, f)).concat(join(__dirname, "ai-api.ts"));
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(/localStorage|sessionStorage/);
  });
});

describe("validateBaseUrl", () => {
  it("requires https", () => {
    expect(validateBaseUrl("http://api.example.com/v1", false).ok).toBe(false);
    expect(validateBaseUrl("ftp://x.com", true).ok).toBe(false);
    expect(validateBaseUrl("no es url", false).ok).toBe(false);
    expect(validateBaseUrl("https://api.example.com/v1/", false)).toEqual({ ok: true, url: "https://api.example.com/v1" });
  });
  it("rejects localhost outside dev only", () => {
    expect(validateBaseUrl("https://localhost:8080/v1", false).ok).toBe(false);
    expect(validateBaseUrl("http://127.0.0.1:11434/v1", false).ok).toBe(false);
    expect(validateBaseUrl("http://localhost:11434/v1", true).ok).toBe(true);
  });
});

describe("budget helpers", () => {
  it("computes the percentage", () => {
    expect(budgetPercent(800, 2000)).toBe(40);
    expect(budgetPercent(2500, 2000)).toBe(125);
    expect(budgetPercent(0, 2000)).toBe(0);
    expect(budgetPercent(100, null)).toBeNull();
    expect(budgetPercent(100, 0)).toBeNull();
  });
  it("flags 80 % and 100 %", () => {
    expect(budgetLevel(79)).toBe("ok");
    expect(budgetLevel(80)).toBe("warn");
    expect(budgetLevel(100)).toBe("exceeded");
    expect(budgetLevel(null)).toBe("ok");
  });
  it("parses money to minor units", () => {
    expect(toMinor("12,50", "EUR")).toBe(1250);
    expect(toMinor("12,50", "CLP")).toBeUndefined(); // CLP has no minor unit
    expect(toMinor("1250", "CLP")).toBe(1250);
    expect(toMinor("abc", "EUR")).toBeUndefined();
    expect(toMinor("-1", "EUR")).toBeUndefined();
  });
});

describe("AI roles", () => {
  it("lets owner and admin edit, agents read, viewers nothing", () => {
    expect(canManageAi("admin")).toBe(true);
    expect(canManageAi("agent")).toBe(false);
    expect(canViewAi("agent")).toBe(true);
    expect(canViewAi("viewer")).toBe(false);
  });
});

describe("usage flags", () => {
  it("parses estimated and currencyMismatch from the API", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json(200, { spentMinor: 10, currency: "EUR", budgetMinor: 100, currencyMismatch: true, estimated: true, byKind: [] })),
    );
    await expect(realAiApi.usage("2026-10")).resolves.toMatchObject({ currencyMismatch: true, estimated: true });
  });
});
