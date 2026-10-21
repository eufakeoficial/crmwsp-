import { describe, expect, it } from "vitest";
import {
  WEBHOOK_MAX_ATTEMPTS,
  apiKeyDisplayPrefix,
  checkWebhookUrl,
  decideDeliveryOutcome,
  formatSignatureHeader,
  isPublicIp,
  parseBearer,
  shouldAutoDisable,
  webhookBackoffMs,
  webhookSignedContent,
} from "./index.js";

const KEY = `crm_live_${"a".repeat(43)}`;

describe("api keys", () => {
  it("parses only well-formed bearer keys", () => {
    expect(parseBearer(`Bearer ${KEY}`)).toBe(KEY);
    expect(parseBearer(`bearer ${KEY}`)).toBe(KEY);
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("Bearer abc")).toBeNull();
    expect(parseBearer(`Basic ${KEY}`)).toBeNull();
    expect(parseBearer(`Bearer ${KEY}x`)).toBeNull();
  });
  it("shows a non-secret prefix", () => {
    expect(apiKeyDisplayPrefix(KEY)).toBe("crm_live_aaaaaaaa");
  });
});

describe("ssrf guard", () => {
  const prod = { allowHttp: false };
  it("requires https in production", () => {
    expect(checkWebhookUrl("http://example.com/h", prod)).toEqual({ ok: false, reason: "https_required" });
    expect(checkWebhookUrl("http://example.com/h", { allowHttp: true }).ok).toBe(true);
    expect(checkWebhookUrl("ftp://example.com", { allowHttp: true }).ok).toBe(false);
  });
  it.each([
    "https://localhost/x",
    "https://127.0.0.1/x",
    "https://10.0.0.5/x",
    "https://172.16.3.1/x",
    "https://192.168.1.1/x",
    "https://169.254.169.254/latest",
    "https://[::1]/x",
    "https://[fd00::1]/x",
    "https://[::ffff:127.0.0.1]/x",
    "https://foo.internal/x",
    "https://0.0.0.0/x",
  ])("rejects private host %s", (u) => {
    expect(checkWebhookUrl(u, prod)).toEqual({ ok: false, reason: "private_host" });
  });
  it("rejects credentials and odd ports", () => {
    expect(checkWebhookUrl("https://u:p@example.com", prod).ok).toBe(false);
    expect(checkWebhookUrl("https://example.com:6379", prod)).toEqual({ ok: false, reason: "port_not_allowed" });
  });
  it("accepts public hosts", () => {
    expect(checkWebhookUrl("https://hooks.example.com/crm", prod).ok).toBe(true);
    expect(checkWebhookUrl("https://8.8.8.8/x", prod).ok).toBe(true);
  });
  it("classifies resolved addresses", () => {
    expect(isPublicIp("8.8.8.8")).toBe(true);
    expect(isPublicIp("2606:4700:4700::1111")).toBe(true);
    expect(isPublicIp("100.64.0.1")).toBe(false);
    expect(isPublicIp("fe80::1")).toBe(false);
    expect(isPublicIp("::")).toBe(false);
    expect(isPublicIp("::ffff:10.0.0.1")).toBe(false);
    expect(isPublicIp("not-an-ip")).toBe(false);
  });
});

describe("delivery policy", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("backs off exponentially with a cap", () => {
    expect(webhookBackoffMs(1)).toBe(30_000);
    expect(webhookBackoffMs(2)).toBe(60_000);
    expect(webhookBackoffMs(30)).toBe(6 * 3600_000);
  });
  it("delivers on 2xx, retries otherwise, fails at the last attempt", () => {
    expect(decideDeliveryOutcome(1, 204, now)).toEqual({ kind: "delivered" });
    expect(decideDeliveryOutcome(1, 500, now)).toEqual({ kind: "retry", nextAttemptAt: new Date(now.getTime() + 30_000) });
    expect(decideDeliveryOutcome(2, null, now).kind).toBe("retry");
    expect(decideDeliveryOutcome(WEBHOOK_MAX_ATTEMPTS, 410, now)).toEqual({ kind: "failed" });
  });
  it("auto-disables after N consecutive failures", () => {
    expect(shouldAutoDisable(19)).toBe(false);
    expect(shouldAutoDisable(20)).toBe(true);
  });
  it("formats the signature", () => {
    expect(webhookSignedContent(1700000000, "{}")).toBe("1700000000.{}");
    expect(formatSignatureHeader(1700000000, "ab")).toBe("t=1700000000,v1=ab");
  });
});
