import { ValidationError } from "@crmwsp/contracts";
import type { z } from "zod";

/** Parses input or throws a ValidationError. Never echoes input values (may hold passwords). */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError("Validation failed", {
      details: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
  }
  return result.data;
}
