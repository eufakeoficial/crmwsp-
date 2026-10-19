import { ValidationError } from "@crmwsp/contracts";
import { z } from "zod";

/**
 * Opaque keyset cursor: base64url(JSON { t, id }) where `t` is the sort timestamp in
 * epoch MICROseconds as a decimal string (Postgres precision; a JS Date would lose it
 * and make pagination unstable). Decoded values are validated with Zod before they
 * reach SQL (always as bound parameters).
 */
const cursorSchema = z
  .object({
    t: z.string().regex(/^-?\d{1,19}$/),
    id: z.string().uuid(),
  })
  .strict();

export type Cursor = z.infer<typeof cursorSchema>;

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid cursor");
  }
  const parsed = cursorSchema.safeParse(json);
  if (!parsed.success) throw new ValidationError("Invalid cursor");
  return parsed.data;
}
