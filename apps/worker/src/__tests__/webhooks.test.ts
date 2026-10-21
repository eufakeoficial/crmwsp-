import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createWebhookSender, guardedLookup, signWebhook } from "../webhooks/index.js";

describe("webhook signing", () => {
  it("signs `${t}.${body}` with HMAC-SHA256", () => {
    const body = '{"id":"e1"}';
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${body}`).digest("hex");
    expect(signWebhook("whsec_test", 1700000000, body)).toBe(`t=1700000000,v1=${expected}`);
  });
});

describe("guarded webhook sender", () => {
  let server: Server;
  let port: number;
  let received: { headers: Record<string, unknown>; body: string } | null = null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = "";
      req.on("data", (c: Buffer) => (body += c.toString()));
      req.on("end", () => {
        received = { headers: req.headers, body };
        res.statusCode = req.url === "/fail" ? 500 : 204;
        res.end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const blockedResolver = (_h: string, cb: (e: NodeJS.ErrnoException | null, a: { address: string; family: number }[]) => void) =>
    cb(null, [{ address: "10.0.0.7", family: 4 }]);

  it("refuses hosts that resolve to private addresses (DNS rebinding safe)", async () => {
    const send = createWebhookSender({ allowHttp: true, lookup: blockedResolver });
    const r = await send({ url: `http://hooks.example.com:8080/x`, headers: {}, body: "{}" });
    expect(r).toEqual({ statusCode: null, error: "EBLOCKEDADDRESS" });
  });

  it("refuses literal private URLs before any connection", async () => {
    const send = createWebhookSender({ allowHttp: true });
    expect(await send({ url: `http://127.0.0.1:${port}/x`, headers: {}, body: "{}" })).toEqual({ statusCode: null, error: "private_host" });
  });

  it("refuses http in production mode", async () => {
    const send = createWebhookSender({ allowHttp: false });
    expect(await send({ url: "http://hooks.example.com/x", headers: {}, body: "{}" })).toEqual({ statusCode: null, error: "https_required" });
  });

  it("never connects to loopback even when DNS returns it", async () => {
    const loopbackResolver = (_h: string, cb: (e: NodeJS.ErrnoException | null, a: { address: string; family: number }[]) => void) =>
      cb(null, [{ address: "127.0.0.1", family: 4 }]);
    const send = createWebhookSender({ allowHttp: true, lookup: loopbackResolver });
    const r = await send({ url: `http://hooks.example.com:8080/ok`, headers: {}, body: "{}" });
    expect(r.error).toBe("EBLOCKEDADDRESS");
    expect(received).toBeNull();
  });

  it("passes public resolutions through to the socket", async () => {
    const lookup = guardedLookup((_h, cb) => cb(null, [{ address: "93.184.216.34", family: 4 }]));
    const got = await new Promise<string>((r) => lookup("x", {}, (_e, addr) => r(String(addr))));
    expect(got).toBe("93.184.216.34");
  });
});
