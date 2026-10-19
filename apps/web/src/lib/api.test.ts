import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tenantIdSchema } from "@crmwsp/contracts";
import { ApiError, api, setActiveTenantId } from "./api";
import { resolveActiveTenant } from "./tenant";

const TENANT_A = tenantIdSchema.parse("11111111-1111-4111-8111-111111111111");
const TENANT_B = tenantIdSchema.parse("22222222-2222-4222-8222-222222222222");
const USER = "33333333-3333-4333-8333-333333333333";

const me = {
  user: { id: USER, email: "a@example.com", name: "Ana" },
  tenants: [{ id: TENANT_A, slug: "acme", name: "Acme", role: "owner" }],
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  setActiveTenantId(null);
});
afterEach(() => vi.unstubAllGlobals());

const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit & { headers: Record<string, string> }];
  return { url, init };
};

describe("api client", () => {
  it("sends credentials and parses a valid response", async () => {
    fetchMock.mockResolvedValue(json(200, me));
    await expect(api.me()).resolves.toEqual(me);
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/me");
    expect(init.credentials).toBe("include");
    expect(init.headers["x-tenant-id"]).toBeUndefined();
  });

  it("adds x-tenant-id when a tenant is active", async () => {
    setActiveTenantId(TENANT_A);
    fetchMock.mockResolvedValue(json(200, { items: [] }));
    await api.members();
    expect(lastCall().init.headers["x-tenant-id"]).toBe(TENANT_A);
  });

  it("posts JSON bodies", async () => {
    fetchMock.mockResolvedValue(json(200, me));
    await api.login({ email: "a@example.com", password: "secret-password" });
    const { url, init } = lastCall();
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ email: "a@example.com", password: "secret-password" });
  });

  it("handles empty 204 responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("maps error responses to ApiError with code and message", async () => {
    fetchMock.mockResolvedValue(json(403, { code: "FORBIDDEN", message: "Forbidden" }));
    const err = await api.members().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "FORBIDDEN", message: "Forbidden", status: 403 });
  });

  it("falls back to a generic error for non-JSON failures", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ code: "INTERNAL_ERROR", status: 502 });
  });

  it("rejects responses that do not match the schema", async () => {
    fetchMock.mockResolvedValue(json(200, { user: {} }));
    await expect(api.me()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("maps network failures", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(api.me()).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });
  });
});

describe("resolveActiveTenant", () => {
  const a = { id: TENANT_A, slug: "a", name: "A", role: "owner" as const };
  const b = { id: TENANT_B, slug: "b", name: "B", role: "agent" as const };

  it("auto-selects the only tenant", () => {
    expect(resolveActiveTenant([a], null)).toEqual(a);
    expect(resolveActiveTenant([a], TENANT_B)).toEqual(a);
  });
  it("uses the stored id only if it is in the list", () => {
    expect(resolveActiveTenant([a, b], TENANT_B)).toEqual(b);
    expect(resolveActiveTenant([a, b], "99999999-9999-4999-8999-999999999999")).toBeNull();
  });
  it("returns null when the user must choose or has no tenants", () => {
    expect(resolveActiveTenant([a, b], null)).toBeNull();
    expect(resolveActiveTenant([], TENANT_A)).toBeNull();
  });
});
