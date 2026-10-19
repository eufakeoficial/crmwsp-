/**
 * Envelope encryption for tenant secrets (BSP API keys, OpenAI BYOK keys).
 *
 * Design:
 * - Master keys (KEKs) are 32 bytes, loaded from ENCRYPTION_MASTER_KEY (base64) with id
 *   ENCRYPTION_MASTER_KEY_ID (1-255, active key), and optionally ENCRYPTION_MASTER_KEY_PREVIOUS
 *   with ENCRYPTION_MASTER_KEY_PREVIOUS_ID (both or neither, id must differ from the active one).
 * - Each secret gets a fresh random 32-byte DEK. The secret is encrypted with AES-256-GCM
 *   (random 12-byte IV) under the DEK; the DEK is encrypted with AES-256-GCM under the KEK.
 * - Both GCM operations bind AAD = header (version, keyId) + tenantId + purpose, so a blob
 *   copied to another tenant or field does not decrypt.
 * - Binary layout (version 1):
 *   version(1) | keyId(1) | dekIv(12) | dekTag(16) | encDek(32) | iv(12) | tag(16) | ciphertext
 * - Rotation: rotate() re-wraps the DEK under the active KEK; the data ciphertext is untouched.
 *   Because the AAD covers keyId, the DEK wrap is recomputed; the data AAD excludes keyId so
 *   the payload stays valid.
 * - Rotation procedure: (1) generate a new key with a NEW id never used before; (2) move the
 *   current key/id to ENCRYPTION_MASTER_KEY_PREVIOUS/_PREVIOUS_ID and set the new one as
 *   ENCRYPTION_MASTER_KEY/_ID; (3) run the rotate job over every stored blob (needsRotation ->
 *   rotate); (4) once none remain on the old id, remove the _PREVIOUS variables.
 * - Every decryption failure surfaces as DecryptionError with a generic message. Plaintext and
 *   keys are never logged or included in errors.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const FORMAT_VERSION = 1;
const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;
const HEADER_LEN = 2;
const DEK_IV_OFF = HEADER_LEN;
const DEK_TAG_OFF = DEK_IV_OFF + IV_LEN;
const ENC_DEK_OFF = DEK_TAG_OFF + TAG_LEN;
const IV_OFF = ENC_DEK_OFF + KEY_LEN;
const TAG_OFF = IV_OFF + IV_LEN;
const CT_OFF = TAG_OFF + TAG_LEN;

export interface SecretContext {
  tenantId: string;
  purpose: string;
}

export interface CipherBoxOptions {
  keys: Map<number, Buffer>;
  activeKeyId: number;
}

export interface CipherBox {
  encrypt(plaintext: string, ctx: SecretContext): Buffer;
  decrypt(blob: Buffer, ctx: SecretContext): string;
  rotate(blob: Buffer, ctx: SecretContext): Buffer;
  needsRotation(blob: Buffer): boolean;
}

export class DecryptionError extends Error {
  constructor() {
    super("Unable to decrypt secret");
    this.name = "DecryptionError";
  }
}

export class MasterKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MasterKeyError";
  }
}

function assertKeyId(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 255) {
    throw new MasterKeyError("Master key id must be an integer between 0 and 255");
  }
}

function decodeMasterKey(name: string, value: string): Buffer {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) {
    throw new MasterKeyError(`${name} must be base64-encoded`);
  }
  const key = Buffer.from(trimmed, "base64");
  // Reject non-canonical encodings (missing padding, non-zero trailing bits) that Buffer accepts.
  if (key.toString("base64") !== trimmed) {
    key.fill(0);
    throw new MasterKeyError(`${name} must be canonical base64`);
  }
  if (key.length !== KEY_LEN) {
    throw new MasterKeyError(`${name} must decode to exactly ${KEY_LEN} bytes (got ${key.length})`);
  }
  return key;
}

export interface MasterKeys {
  keys: Map<number, Buffer>;
  activeKeyId: number;
}

function parseKeyId(name: string, raw: string | undefined): number {
  if (!raw || !/^\d+$/.test(raw.trim()))
    throw new MasterKeyError(`${name} must be an integer between 1 and 255`);
  const id = Number(raw.trim());
  if (id < 1 || id > 255) throw new MasterKeyError(`${name} must be an integer between 1 and 255`);
  return id;
}

export function loadMasterKeysFromEnv(env: Record<string, string | undefined>): MasterKeys {
  const current = env.ENCRYPTION_MASTER_KEY;
  if (!current) throw new MasterKeyError("ENCRYPTION_MASTER_KEY is not set");
  const activeKeyId = parseKeyId("ENCRYPTION_MASTER_KEY_ID", env.ENCRYPTION_MASTER_KEY_ID);
  const keys = new Map<number, Buffer>([
    [activeKeyId, decodeMasterKey("ENCRYPTION_MASTER_KEY", current)],
  ]);

  const previous = env.ENCRYPTION_MASTER_KEY_PREVIOUS;
  const previousId = env.ENCRYPTION_MASTER_KEY_PREVIOUS_ID;
  if (Boolean(previous) !== Boolean(previousId)) {
    throw new MasterKeyError(
      "ENCRYPTION_MASTER_KEY_PREVIOUS and ENCRYPTION_MASTER_KEY_PREVIOUS_ID must be set together",
    );
  }
  if (previous) {
    const id = parseKeyId("ENCRYPTION_MASTER_KEY_PREVIOUS_ID", previousId);
    if (id === activeKeyId) {
      throw new MasterKeyError(
        "ENCRYPTION_MASTER_KEY_PREVIOUS_ID must differ from ENCRYPTION_MASTER_KEY_ID",
      );
    }
    keys.set(id, decodeMasterKey("ENCRYPTION_MASTER_KEY_PREVIOUS", previous));
  }
  return { keys, activeKeyId };
}

function contextAad(ctx: SecretContext): Buffer {
  if (!ctx.tenantId || !ctx.purpose) throw new Error("tenantId and purpose are required");
  // Length-prefixed to avoid ambiguity between ("ab","c") and ("a","bc").
  const t = Buffer.from(ctx.tenantId, "utf8");
  const p = Buffer.from(ctx.purpose, "utf8");
  const lens = Buffer.alloc(8);
  lens.writeUInt32BE(t.length, 0);
  lens.writeUInt32BE(p.length, 4);
  return Buffer.concat([lens, t, p]);
}

function gcmEncrypt(
  key: Buffer,
  data: Buffer,
  aad: Buffer,
): { iv: Buffer; tag: Buffer; ct: Buffer } {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { iv, tag: c.getAuthTag(), ct };
}

function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer, aad: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  d.setAAD(aad);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

export function createCipherBox(options: CipherBoxOptions): CipherBox {
  const keys = new Map<number, Buffer>();
  for (const [id, key] of options.keys) {
    assertKeyId(id);
    if (key.length !== KEY_LEN)
      throw new MasterKeyError(`Master key ${id} must be ${KEY_LEN} bytes`);
    keys.set(id, Buffer.from(key));
  }
  const activeKeyId = options.activeKeyId;
  const activeKey = keys.get(activeKeyId);
  if (!activeKey) throw new MasterKeyError(`Active key id ${activeKeyId} is not configured`);

  const dekAad = (keyId: number, ctxAad: Buffer): Buffer =>
    Buffer.concat([Buffer.from([FORMAT_VERSION, keyId]), Buffer.from("dek"), ctxAad]);
  const dataAad = (ctxAad: Buffer): Buffer =>
    Buffer.concat([Buffer.from([FORMAT_VERSION]), Buffer.from("data"), ctxAad]);

  function wrapDek(dek: Buffer, keyId: number, key: Buffer, ctxAad: Buffer): Buffer {
    const w = gcmEncrypt(key, dek, dekAad(keyId, ctxAad));
    return Buffer.concat([Buffer.from([FORMAT_VERSION, keyId]), w.iv, w.tag, w.ct]);
  }

  function unwrap(blob: Buffer, ctx: SecretContext): { dek: Buffer; ctxAad: Buffer } {
    try {
      if (!Buffer.isBuffer(blob) || blob.length < CT_OFF || blob[0] !== FORMAT_VERSION) {
        throw new DecryptionError();
      }
      const keyId = blob[1]!;
      const key = keys.get(keyId);
      if (!key) throw new DecryptionError();
      const ctxAad = contextAad(ctx);
      const dek = gcmDecrypt(
        key,
        blob.subarray(DEK_IV_OFF, DEK_TAG_OFF),
        blob.subarray(DEK_TAG_OFF, ENC_DEK_OFF),
        blob.subarray(ENC_DEK_OFF, IV_OFF),
        dekAad(keyId, ctxAad),
      );
      return { dek, ctxAad };
    } catch {
      throw new DecryptionError();
    }
  }

  return {
    encrypt(plaintext, ctx) {
      const ctxAad = contextAad(ctx);
      const dek = randomBytes(KEY_LEN);
      try {
        const data = gcmEncrypt(dek, Buffer.from(plaintext, "utf8"), dataAad(ctxAad));
        return Buffer.concat([
          wrapDek(dek, activeKeyId, activeKey, ctxAad),
          data.iv,
          data.tag,
          data.ct,
        ]);
      } finally {
        dek.fill(0);
      }
    },
    decrypt(blob, ctx) {
      const { dek, ctxAad } = unwrap(blob, ctx);
      try {
        const pt = gcmDecrypt(
          dek,
          blob.subarray(IV_OFF, TAG_OFF),
          blob.subarray(TAG_OFF, CT_OFF),
          blob.subarray(CT_OFF),
          dataAad(ctxAad),
        );
        return pt.toString("utf8");
      } catch {
        throw new DecryptionError();
      } finally {
        dek.fill(0);
      }
    },
    rotate(blob, ctx) {
      // Verify the payload fully before re-wrapping so we never rotate a corrupt blob.
      this.decrypt(blob, ctx);
      const { dek, ctxAad } = unwrap(blob, ctx);
      try {
        return Buffer.concat([wrapDek(dek, activeKeyId, activeKey, ctxAad), blob.subarray(IV_OFF)]);
      } finally {
        dek.fill(0);
      }
    },
    needsRotation(blob) {
      return blob.length < HEADER_LEN || blob[0] !== FORMAT_VERSION || blob[1] !== activeKeyId;
    },
  };
}

/** Masks a secret for display: "••••" + last 4 chars. */
export function redact(secret: string): string {
  const chars = Array.from(secret);
  if (chars.length <= 4) return "••••";
  return "••••" + chars.slice(-4).join("");
}
