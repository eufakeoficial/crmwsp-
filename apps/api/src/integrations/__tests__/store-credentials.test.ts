import { describe, expect, it } from "vitest";
import { resolveStoreCredentials } from "../store-credentials.js";

const secret = { webhookSecret: "secret-123456" };

describe("resolveStoreCredentials", () => {
  it("normalizes per-provider store locators", () => {
    expect(resolveStoreCredentials("shopify", { ...secret, shopDomain: "My-Shop.myshopify.com", accessToken: "shpat_1234567890" })).toEqual({
      shopDomain: "my-shop.myshopify.com",
      accessToken: "shpat_1234567890",
    });
    expect(resolveStoreCredentials("tiendanube", { ...secret, shopDomain: "123456", accessToken: "tn_token_123456" })).toEqual({ shopDomain: "123456", accessToken: "tn_token_123456" });
    expect(resolveStoreCredentials("woocommerce", { ...secret, shopDomain: "https://tienda.example.com/", consumerKey: "ck_abcdef123456", consumerSecret: "cs_abcdef123456" })).toEqual({
      shopDomain: "https://tienda.example.com",
      accessToken: "ck_abcdef123456:cs_abcdef123456",
    });
  });

  it("rejects mismatched or unsafe credentials", () => {
    expect(() => resolveStoreCredentials("hotmart", { ...secret, shopDomain: "x" })).toThrow();
    expect(() => resolveStoreCredentials("tiendanube", { ...secret, shopDomain: "evil.com" })).toThrow();
    expect(() => resolveStoreCredentials("woocommerce", { ...secret, shopDomain: "http://127.0.0.1" })).toThrow();
    expect(() => resolveStoreCredentials("woocommerce", { ...secret, shopDomain: "https://t.example.com", consumerKey: "ck_abcdef123456" })).toThrow();
    expect(() => resolveStoreCredentials("shopify", { ...secret, accessToken: "shpat_1234567890" })).toThrow();
    expect(() => resolveStoreCredentials("shopify", { ...secret, consumerKey: "ck_abcdef123456", consumerSecret: "cs_abcdef123456" })).toThrow();
  });
});
