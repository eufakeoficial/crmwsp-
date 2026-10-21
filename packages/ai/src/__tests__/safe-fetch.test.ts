import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../provider/openai-compatible.js";
import { BlockedAddressError, createSafeFetch, guardedLookup } from "../provider/safe-fetch.js";

let server: Server;
let port = 0;
let hits = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    hits++;
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data" });
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe("guardedLookup", () => {
  it("refuses blocked addresses at connect time", async () => {
    const lookup = guardedLookup({ lookup: async () => [{ address: "169.254.169.254" }] });
    const err = await new Promise<unknown>((r) => lookup("x.example.com", {}, (e) => r(e)));
    expect(err).toBeInstanceOf(BlockedAddressError);
  });

  it("passes public addresses through", async () => {
    const lookup = guardedLookup({ lookup: async () => [{ address: "8.8.8.8" }] });
    const out = await new Promise<unknown>((r) => lookup("x.example.com", {}, (_e, a) => r(a)));
    expect(out).toBe("8.8.8.8");
  });
});

describe("createSafeFetch", () => {
  it("does not connect when the host resolves to loopback, even if a server is listening", async () => {
    const before = hits;
    const f = createSafeFetch({ lookup: async () => [{ address: "127.0.0.1" }] });
    await expect(f(`http://rebind.example.com:${port}/`)).rejects.toThrow();
    expect(hits).toBe(before);
  });

  it("rejects redirects", async () => {
    const f = createSafeFetch({ allowPrivate: true, lookup: async () => [{ address: "127.0.0.1" }] });
    await expect(f(`http://local.example.com:${port}/redirect`)).rejects.toThrow();
    const ok = await f(`http://local.example.com:${port}/`);
    expect(ok.status).toBe(200);
  });
});

describe("OpenAICompatibleProvider DNS rebinding (CN-009)", () => {
  it("public IP at check time, metadata IP at connect time -> connection refused", async () => {
    const lookup = vi
      .fn<(h: string) => Promise<Array<{ address: string }>>>()
      .mockResolvedValueOnce([{ address: "8.8.8.8" }])
      .mockResolvedValue([{ address: "169.254.169.254" }]);
    const p = new OpenAICompatibleProvider({ baseUrl: "https://rebind.example.com/v1", apiKey: "sk-test", lookup, production: true });
    await expect(p.embed({ model: "m", input: ["hi"] })).rejects.toThrow(/Network error/);
    expect(lookup.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
