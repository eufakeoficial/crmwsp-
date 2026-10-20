import { randomUUID } from "node:crypto";
import { computeLineTotal } from "@crmwsp/db";
import { describe, expect, it } from "vitest";
import { sniffImage } from "../commerce/media.controller.js";
import { cleanOptions, optionKeyOf } from "../commerce/products.queries.js";
import { buildLine, needsApproval, newAcceptToken, parseAcceptToken, variantLabel } from "../sales/quote.service.js";
import { s3ConfigFromEnv, StorageHolder } from "../storage/object-storage.js";

describe("line math parity", () => {
  it("buildLine agrees with computeLineTotal for odd rounding cases", () => {
    for (const [q, p, d, t] of [[1500n, 1000n, 1000, 2100], [333n, 999n, 250, 700], [1n, 1n, 0, 0], [1_000_000n, 1_000_000_000n, 10_000, 10_000], [2500n, 5n, 3333, 1]] as const) {
      expect(buildLine({ productId: null, productVersion: null, description: "x", quantityMilli: q, unit: "ud", unitPriceMinor: p, discountBp: d, taxRateBp: t }).lineTotalMinor).toBe(
        computeLineTotal(q, p, d, t),
      );
    }
  });
});

describe("approval rule", () => {
  it("needs approval above the threshold or with any discount", () => {
    expect(needsApproval(10_001n, 0n, 10_000n)).toBe(true);
    expect(needsApproval(10_000n, 0n, 10_000n)).toBe(false);
    expect(needsApproval(1n, 1n, null)).toBe(true);
    expect(needsApproval(9_999_999n, 0n, null)).toBe(false);
  });
});

describe("accept token", () => {
  it("round-trips tenant + hash and rejects malformed tokens", () => {
    const tenant = randomUUID();
    const { token, hash } = newAcceptToken(tenant);
    const parsed = parseAcceptToken(token);
    expect(parsed?.tenantId).toBe(tenant);
    expect(parsed?.hash.equals(hash)).toBe(true);
    expect(token.split(".")[1]).toHaveLength(43); // 32 bytes, base64url
    expect(parseAcceptToken("nope")).toBeNull();
    expect(parseAcceptToken(`${tenant}.abc`)).toBeNull();
    expect(newAcceptToken(tenant).token).not.toBe(token);
  });
});

describe("variants and images", () => {
  it("normalizes option keys independent of order and case", () => {
    expect(optionKeyOf({ Talla: " M ", color: "Negro" })).toBe(optionKeyOf({ color: "negro", talla: "m" }));
    expect(optionKeyOf({})).toBe("");
    expect(cleanOptions({ " talla ": " M " })).toEqual({ talla: "M" });
    expect(variantLabel("Camiseta", { talla: "M", color: "Negro" })).toBe("Camiseta (M / Negro)");
  });
  it("sniffs real image signatures only", () => {
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe("image/jpeg");
    expect(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(4)]))?.mime).toBe("image/png");
    expect(sniffImage(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]))?.mime).toBe("image/webp");
    expect(sniffImage(Buffer.from("GIF89a"))).toBeNull();
    expect(sniffImage(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe("object storage config", () => {
  it("is null without bucket/credentials and parses the S3_* variables", () => {
    expect(s3ConfigFromEnv({})).toBeNull();
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY: "k" })).toBeNull();
    expect(s3ConfigFromEnv({ S3_BUCKET: "b", S3_ACCESS_KEY: "k", S3_SECRET_KEY: "s", S3_ENDPOINT: "http://localhost:9000", S3_FORCE_PATH_STYLE: "true" })).toEqual({
      endpoint: "http://localhost:9000",
      region: "us-east-1",
      bucket: "b",
      accessKey: "k",
      secretKey: "s",
      forcePathStyle: true,
    });
  });
  it("require() answers 503 when unconfigured", () => {
    expect(() => new StorageHolder(null).require()).toThrowError(expect.objectContaining({ httpStatus: 503, code: "STORAGE_NOT_CONFIGURED" }) as Error);
  });
});
