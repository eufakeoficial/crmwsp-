import { z } from "zod";

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** True when `n` has at most `places` decimal digits (tolerant to float noise). */
function hasMaxDecimals(n: number, places: number): boolean {
  const scaled = n * 10 ** places;
  return Math.abs(scaled - Math.round(scaled)) < 1e-7;
}

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => text(max).optional();

const percent = z
  .number()
  .min(0)
  .max(100)
  .refine((n) => hasMaxDecimals(n, 2), "at most 2 decimals");

export const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "expected #rrggbb");

export const QuoteItemSchema = z.object({
  description: text(1000),
  /** Positive, up to 3 decimals (stored as thousandths while computing). */
  quantity: z
    .number()
    .positive()
    .max(1000)
    .refine((n) => hasMaxDecimals(n, 3), "at most 3 decimals"),
  unit: optionalText(20),
  /** Integer in minor units (cents). Floats are rejected on purpose. */
  unitPriceMinor: z.number().int().nonnegative().max(1_000_000_000), // keeps every sum below Number.MAX_SAFE_INTEGER
  discountPercent: percent.optional(),
  taxRatePercent: percent.optional(),
});

export const QuoteDocumentSchema = z.object({
  number: text(40),
  /** ISO calendar date, YYYY-MM-DD. */
  issueDate: z.iso.date(),
  validUntil: z.iso.date(),
  /** ISO 4217 code. */
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .refine((c) => Intl.supportedValuesOf("currency").includes(c), "unknown currency"),
  locale: z
    .string()
    .default("es")
    .refine((l) => {
      try {
        return Intl.getCanonicalLocales(l).length === 1;
      } catch {
        return false;
      }
    }, "invalid locale"),
  seller: z.object({
    name: text(200),
    taxId: optionalText(50),
    address: optionalText(400),
    phone: optionalText(50),
    email: optionalText(200),
    logoPng: z
      .instanceof(Uint8Array)
      .refine(
        (b) => b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v),
        "logoPng must be a PNG",
      )
      .optional(),
  }),
  customer: z.object({
    name: text(200),
    phone: optionalText(50),
    email: optionalText(200),
    address: optionalText(400),
    taxId: optionalText(50),
  }),
  items: z.array(QuoteItemSchema).min(1).max(500),
  notes: optionalText(5000),
  terms: optionalText(5000),
  /** Absolute URL; rendered as QR code and clickable link. */
  paymentLink: z.url().max(350).optional(),
  /** Accent color. Defaults to lime. */
  brandColor: HexColorSchema.default("#d2f34c"),
});

export type QuoteItem = z.output<typeof QuoteItemSchema>;
export type QuoteDocument = z.output<typeof QuoteDocumentSchema>;
/** Accepted by `renderQuotePdf` (defaults not yet applied). */
export type QuoteDocumentInput = z.input<typeof QuoteDocumentSchema>;
