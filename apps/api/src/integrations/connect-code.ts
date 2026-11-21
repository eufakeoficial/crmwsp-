import { createHash, randomBytes } from "node:crypto";
import { CONNECT_CODE_ALPHABET, CONNECT_CODE_LENGTH } from "@crmwsp/contracts";

/** Connect codes live 15 minutes (the SQL function clamps to 60..3600 s). */
export const CONNECT_CODE_TTL_SECONDS = 900;

/** 10 uniform chars over a 32-symbol alphabet (50 bits): 256 is a multiple of 32, so no modulo bias. */
export function generateConnectCode(): string {
  const bytes = randomBytes(CONNECT_CODE_LENGTH);
  let out = "";
  for (const b of bytes) out += CONNECT_CODE_ALPHABET[b & 31];
  return out;
}

/** XXXX-XXXX-XX, for display only; the plugin may send it with or without dashes. */
export function formatConnectCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

/** Only the SHA-256 of the normalized code is stored. */
export function hashConnectCode(normalizedCode: string): Buffer {
  return createHash("sha256").update(normalizedCode, "utf8").digest();
}
