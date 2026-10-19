import { z } from "zod";

// zod v4 top-level format (z.string().uuid() is deprecated in v4). Strict RFC 9562 UUID.
export const uuidSchema = z.uuid();

export const tenantIdSchema = uuidSchema.brand<"TenantId">();
export type TenantId = z.infer<typeof tenantIdSchema>;

/** E.164: "+" followed by 2-15 digits, first digit non-zero. */
export const e164PhoneSchema = z.string().regex(/^\+[1-9]\d{1,14}$/, "Invalid E.164 phone number");

// zod v4 preferred form (z.string().datetime() is deprecated in v4).
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/** ISO 4217 currency code: three uppercase letters. */
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Invalid ISO 4217 currency code");

/** Money in minor units (e.g. cents) to avoid floating point errors. */
export const moneySchema = z.object({
  amountMinor: z.number().int().nonnegative(),
  currency: currencySchema,
});
export type Money = z.infer<typeof moneySchema>;

export const paginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginatedSchema = <T extends z.ZodType>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
