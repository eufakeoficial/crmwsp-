import { describe, expect, it } from "vitest";
import { UnsafeBaseUrlError } from "../errors.js";
import { OpenAICompatibleProvider } from "../provider/openai-compatible.js";
import { assertSafeBaseUrl, isBlockedIp } from "../provider/url-safety.js";
import { publicLookup } from "./helpers.js";
import type { LookupFn } from "../provider/url-safety.js";

const prod = { production: true, lookup: publicLookup };

describe("isBlockedIp", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
    "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "224.0.0.1",
  ])("blocks %s", (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(["8.8.8.8", "93.184.216.34", "2606:4700::1111"])("allows %s", (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe("assertSafeBaseUrl", () => {
  it("accepts a public https URL", async () => {
    await expect(assertSafeBaseUrl("https://api.openai.com/v1", prod)).resolves.toBeInstanceOf(URL);
  });
  it.each([
    "http://api.openai.com/v1",
    "https://localhost/v1",
    "https://foo.localhost",
    "https://127.0.0.1/v1",
    "https://169.254.169.254/latest",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://10.0.0.5",
    "https://user:pass@api.openai.com",
    "ftp://api.openai.com",
    "not a url",
  ])("rejects %s", async (url) => {
    await expect(assertSafeBaseUrl(url, prod)).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  });
  it("rejects hosts that resolve to private IPs (any of them)", async () => {
    await expect(
      assertSafeBaseUrl("https://rebind.example.com", { production: true, lookup: async () => [{ address: "1.1.1.1" }, { address: "10.0.0.1" }] }),
    ).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  });
  it("allowInsecureLocal permits http://localhost outside production only", async () => {
    await expect(assertSafeBaseUrl("http://localhost:11434/v1", { allowInsecureLocal: true, production: false })).resolves.toBeInstanceOf(URL);
    await expect(assertSafeBaseUrl("http://localhost:11434/v1", { allowInsecureLocal: true, production: true })).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  });
  it("provider constructor fails fast on unsafe URL", () => {
    expect(() => new OpenAICompatibleProvider({ baseUrl: "http://169.254.169.254", apiKey: "k", production: true })).toThrow(UnsafeBaseUrlError);
  });
});

describe("SSRF bypass vectors (gate F2-B)", () => {
  const reject = async (url: string, lookup: LookupFn = publicLookup) =>
    expect(assertSafeBaseUrl(url, { production: true, lookup })).rejects.toBeInstanceOf(UnsafeBaseUrlError);
  it.each([
    ["decimal IPv4", "https://2130706433/v1"],
    ["hex IPv4", "https://0x7f.1/v1"],
    ["octal IPv4", "https://017700000001/v1"],
    ["short IPv4", "https://127.1/v1"],
    ["IPv6 loopback", "https://[::1]/v1"],
    ["IPv4-mapped IPv6", "https://[::ffff:127.0.0.1]/v1"],
    ["IPv4-mapped metadata (expanded)", "https://[0:0:0:0:0:ffff:a9fe:a9fe]/"],
    ["IPv4-translated (SIIT)", "https://[::ffff:0:7f00:1]/"],
    ["NAT64", "https://[64:ff9b::a9fe:a9fe]/"],
    ["ULA IPv6", "https://[fd00::1]/v1"],
    ["unspecified IPv4", "https://0.0.0.0/v1"],
    ["uppercase localhost", "https://LOCALHOST/v1"],
    ["trailing dot", "https://localhost./v1"],
    ["uppercase + trailing dot", "https://LocalHost./v1"],
    ["IDN that NFKC-folds to localhost", "https://\u24DBocalhost/v1"],
    ["userinfo", "https://user@api.openai.com/v1"],
    ["userinfo hiding host", "https://api.openai.com@127.0.0.1/v1"],
    ["non-standard port", "https://api.openai.com:6379/v1"],
    ["internal suffix", "https://metadata.google.internal/"],
  ])("rejects %s (%s)", async (_name, url) => reject(url));

  it("rejects a name that resolves to a private IP", async () => reject("https://innocent.example.com", async () => [{ address: "192.168.1.10" }]));
  it("rejects a name that resolves to IPv6 loopback", async () => reject("https://innocent.example.com", async () => [{ address: "::1" }]));
  it("rejects when ANY of several resolved IPs is private", async () =>
    reject("https://multi.example.com", async () => [{ address: "8.8.8.8" }, { address: "2606:4700::1111" }, { address: "fd12::5" }]));
  it("rejects a homograph IDN that resolves to a private IP", async () =>
    reject("https://l\u043Ecalhost.com", async (h) => (h.startsWith("xn--") ? [{ address: "127.0.0.1" }] : [{ address: "8.8.8.8" }])));
  it("passes the punycode host to DNS for IDNs and accepts a public result", async () => {
    let seen = "";
    await expect(
      assertSafeBaseUrl("https://b\u00FCcher.example/v1", { production: true, lookup: async (h) => ((seen = h), [{ address: "8.8.8.8" }]) }),
    ).resolves.toBeInstanceOf(URL);
    expect(seen).toBe("xn--bcher-kva.example");
  });
  it("accepts explicit :443", async () => {
    await expect(assertSafeBaseUrl("https://api.openai.com:443/v1", prod)).resolves.toBeInstanceOf(URL);
  });
  it("fails closed when DNS returns nothing", async () => {
    await expect(assertSafeBaseUrl("https://x.example.com", { production: true, lookup: async () => [] })).rejects.toBeInstanceOf(Error);
  });
});
