import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  DecryptionError,
  MasterKeyError,
  createCipherBox,
  loadMasterKeysFromEnv,
  redact,
} from "./index";

const k1 = randomBytes(32);
const k2 = randomBytes(32);
const ctx = { tenantId: "tenant-a", purpose: "gupshup_api_key" };
const secret = "sk-live-SUPERSECRET-1234";
const box = createCipherBox({ keys: new Map([[1, k1]]), activeKeyId: 1 });

describe("cipher box", () => {
  it("roundtrips", () => {
    expect(box.decrypt(box.encrypt(secret, ctx), ctx)).toBe(secret);
  });

  it("handles empty and unicode plaintext", () => {
    expect(box.decrypt(box.encrypt("", ctx), ctx)).toBe("");
    const u = "clé ñandú 🔐 日本語";
    expect(box.decrypt(box.encrypt(u, ctx), ctx)).toBe(u);
  });

  it("produces different ciphertext for the same plaintext", () => {
    expect(box.encrypt(secret, ctx).equals(box.encrypt(secret, ctx))).toBe(false);
  });

  it("fails with another tenantId", () => {
    const blob = box.encrypt(secret, ctx);
    expect(() => box.decrypt(blob, { ...ctx, tenantId: "tenant-b" })).toThrow(DecryptionError);
  });

  it("fails with another purpose", () => {
    const blob = box.encrypt(secret, ctx);
    expect(() => box.decrypt(blob, { ...ctx, purpose: "openai_api_key" })).toThrow(DecryptionError);
  });

  it("fails on a bit flip anywhere", () => {
    const blob = box.encrypt(secret, ctx);
    for (let i = 0; i < blob.length; i++) {
      const bad = Buffer.from(blob);
      bad[i] = bad[i]! ^ 0x01;
      expect(() => box.decrypt(bad, ctx), `byte ${i}`).toThrow(DecryptionError);
    }
  });

  it("fails on truncation", () => {
    const blob = box.encrypt(secret, ctx);
    expect(() => box.decrypt(blob.subarray(0, 50), ctx)).toThrow(DecryptionError);
  });

  it("fails on truncation at every length up to the header and beyond", () => {
    const blob = box.encrypt(secret, ctx);
    for (let n = 0; n < blob.length; n++) {
      expect(() => box.decrypt(blob.subarray(0, n), ctx), `len ${n}`).toThrow(DecryptionError);
    }
    const empty = box.encrypt("", ctx);
    for (let n = 0; n < empty.length; n++) {
      expect(() => box.decrypt(empty.subarray(0, n), ctx), `len ${n}`).toThrow(DecryptionError);
    }
    expect(box.decrypt(empty, ctx)).toBe("");
  });

  it("fails when keyId is swapped to another configured key", () => {
    const two = createCipherBox({ keys: new Map([[1, k1], [2, k2]]), activeKeyId: 1 });
    const blob = two.encrypt(secret, ctx);
    blob[1] = 2;
    expect(() => two.decrypt(blob, ctx)).toThrow(DecryptionError);
  });

  it("fails on unknown version", () => {
    const blob = box.encrypt(secret, ctx);
    blob[0] = 2;
    expect(() => box.decrypt(blob, ctx)).toThrow(DecryptionError);
  });

  it("fails on unknown keyId", () => {
    const blob = box.encrypt(secret, ctx);
    blob[1] = 9;
    expect(() => box.decrypt(blob, ctx)).toThrow(DecryptionError);
  });

  it("rotates from key 1 to key 2", () => {
    const blob = box.encrypt(secret, ctx);
    const both = createCipherBox({
      keys: new Map([
        [1, k1],
        [2, k2],
      ]),
      activeKeyId: 2,
    });
    expect(both.needsRotation(blob)).toBe(true);
    const rotated = both.rotate(blob, ctx);
    expect(both.needsRotation(rotated)).toBe(false);
    expect(rotated[1]).toBe(2);
    expect(rotated.subarray(64).equals(blob.subarray(64))).toBe(true);
    const only2 = createCipherBox({ keys: new Map([[2, k2]]), activeKeyId: 2 });
    expect(only2.decrypt(rotated, ctx)).toBe(secret);
    expect(() => only2.decrypt(blob, ctx)).toThrow(DecryptionError);
  });

  it("does not leak sensitive data in DecryptionError", () => {
    const blob = box.encrypt(secret, ctx);
    try {
      box.decrypt(blob, { ...ctx, tenantId: "tenant-b" });
      expect.unreachable();
    } catch (e) {
      const msg = String((e as Error).message) + String((e as Error).stack);
      for (const s of [
        secret,
        "tenant-a",
        "tenant-b",
        "gupshup",
        k1.toString("base64"),
        k1.toString("hex"),
      ]) {
        expect(msg).not.toContain(s);
      }
      expect((e as Error).message).toBe("Unable to decrypt secret");
    }
  });
});

describe("loadMasterKeysFromEnv", () => {
  it("loads current and previous keys", () => {
    const mk = loadMasterKeysFromEnv({
      ENCRYPTION_MASTER_KEY: k2.toString("base64"),
      ENCRYPTION_MASTER_KEY_ID: "8",
      ENCRYPTION_MASTER_KEY_PREVIOUS: k1.toString("base64"),
      ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "7",
    });
    expect(mk.activeKeyId).toBe(8);
    expect(mk.keys.get(8)?.equals(k2)).toBe(true);
    expect(mk.keys.get(7)?.equals(k1)).toBe(true);
    expect(createCipherBox(mk).decrypt(createCipherBox(mk).encrypt("x", ctx), ctx)).toBe("x");
  });

  it("rejects wrong-length master key without echoing it", () => {
    const short = randomBytes(16).toString("base64");
    try {
      loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: short, ENCRYPTION_MASTER_KEY_ID: "1" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MasterKeyError);
      expect((e as Error).message).not.toContain(short);
    }
    expect(() =>
      loadMasterKeysFromEnv({
        ENCRYPTION_MASTER_KEY: randomBytes(33).toString("base64"),
        ENCRYPTION_MASTER_KEY_ID: "1",
      }),
    ).toThrow(MasterKeyError);
    expect(() => loadMasterKeysFromEnv({})).toThrow(MasterKeyError);
    const good = randomBytes(32).toString("base64");
    for (const bad of [good.replace(/=$/, ""), good.slice(0, 42) + "B=", good + "!", "@@" + good]) {
      expect(() =>
        loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: bad, ENCRYPTION_MASTER_KEY_ID: "1" }),
      ).toThrow(MasterKeyError);
    }
    expect(() =>
      createCipherBox({ keys: new Map([[1, randomBytes(31)]]), activeKeyId: 1 }),
    ).toThrow(MasterKeyError);
  });
});

describe("loadMasterKeysFromEnv ids", () => {
  const b = (k: Buffer) => k.toString("base64");
  it.each(["", "0", "256", "abc", "1.5", "-1"])("rejects active id %j", (id) => {
    expect(() =>
      loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: b(k1), ENCRYPTION_MASTER_KEY_ID: id }),
    ).toThrow(MasterKeyError);
  });
  it("requires active id", () => {
    expect(() => loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: b(k1) })).toThrow(MasterKeyError);
  });
  it("rejects duplicate, invalid or half-set previous", () => {
    const base = { ENCRYPTION_MASTER_KEY: b(k2), ENCRYPTION_MASTER_KEY_ID: "2" };
    for (const extra of [
      { ENCRYPTION_MASTER_KEY_PREVIOUS: b(k1), ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "2" },
      { ENCRYPTION_MASTER_KEY_PREVIOUS: b(k1), ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "300" },
      { ENCRYPTION_MASTER_KEY_PREVIOUS: b(k1), ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "x" },
      { ENCRYPTION_MASTER_KEY_PREVIOUS: b(k1) },
      { ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "1" },
    ]) {
      expect(() => loadMasterKeysFromEnv({ ...base, ...extra })).toThrow(MasterKeyError);
    }
  });
});

describe("double rotation via env", () => {
  it("rotates 1 -> 2 -> 3 keeping each stage decryptable", () => {
    const k3 = randomBytes(32);
    const b = (k: Buffer) => k.toString("base64");
    const stage1 = createCipherBox(
      loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: b(k1), ENCRYPTION_MASTER_KEY_ID: "1" }),
    );
    const blob1 = stage1.encrypt(secret, ctx);

    const stage2 = createCipherBox(
      loadMasterKeysFromEnv({
        ENCRYPTION_MASTER_KEY: b(k2),
        ENCRYPTION_MASTER_KEY_ID: "2",
        ENCRYPTION_MASTER_KEY_PREVIOUS: b(k1),
        ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "1",
      }),
    );
    expect(stage2.decrypt(blob1, ctx)).toBe(secret);
    const blob2 = stage2.rotate(blob1, ctx);
    const fresh2 = stage2.encrypt("fresh", ctx);
    expect(blob2[1]).toBe(2);

    const stage3 = createCipherBox(
      loadMasterKeysFromEnv({
        ENCRYPTION_MASTER_KEY: b(k3),
        ENCRYPTION_MASTER_KEY_ID: "3",
        ENCRYPTION_MASTER_KEY_PREVIOUS: b(k2),
        ENCRYPTION_MASTER_KEY_PREVIOUS_ID: "2",
      }),
    );
    expect(stage3.decrypt(blob2, ctx)).toBe(secret);
    expect(stage3.decrypt(fresh2, ctx)).toBe("fresh");
    expect(() => stage3.decrypt(blob1, ctx)).toThrow(DecryptionError);
    const blob3 = stage3.rotate(blob2, ctx);
    const fresh3 = stage3.rotate(fresh2, ctx);

    const final = createCipherBox(
      loadMasterKeysFromEnv({ ENCRYPTION_MASTER_KEY: b(k3), ENCRYPTION_MASTER_KEY_ID: "3" }),
    );
    expect(final.needsRotation(blob3)).toBe(false);
    expect(final.decrypt(blob3, ctx)).toBe(secret);
    expect(final.decrypt(fresh3, ctx)).toBe("fresh");
    expect(() => final.decrypt(blob2, ctx)).toThrow(DecryptionError);
  });
});

describe("redact", () => {
  it("masks all but last 4", () => {
    expect(redact("sk-abcdef1234")).toBe("••••1234");
    expect(redact("abc")).toBe("••••");
  });
});
