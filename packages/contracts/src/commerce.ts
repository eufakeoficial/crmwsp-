import { z } from "zod";
import { currencySchema, isoDateTimeSchema, uuidSchema } from "./common.js";
import { contactRefSchema } from "./sales.js";

// --- Catalog -----------------------------------------------------------------------

export const productKindSchema = z.enum(["physical", "service", "digital"]);
export const productStatusSchema = z.enum(["draft", "active", "archived"]);
export const optionsSchema = z.record(z.string().trim().min(1).max(40), z.string().trim().min(1).max(80));

export const variantSchema = z.object({
  id: uuidSchema,
  sku: z.string().nullable(),
  options: z.record(z.string(), z.string()),
  /** null = uses the product price. */
  priceMinor: z.number().int().nullable(),
  compareAtMinor: z.number().int().nullable(),
  stockOnHand: z.number().int(),
  stockReserved: z.number().int(),
  stockAvailable: z.number().int(),
  isActive: z.boolean(),
  position: z.number().int(),
});
export type Variant = z.infer<typeof variantSchema>;

export const productMediaKindSchema = z.enum(["image", "video_link", "document"]);
export const mediaSchema = z.object({
  id: uuidSchema,
  kind: productMediaKindSchema,
  variantId: uuidSchema.nullable(),
  alt: z.string().nullable(),
  position: z.number().int(),
  /** Only for video_link. Images/documents are served through GET /media/:id (signed, short-lived). */
  url: z.string().nullable(),
});
export type Media = z.infer<typeof mediaSchema>;

export const productSchema = z.object({
  id: uuidSchema,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  priceMinor: z.number().int(),
  currency: currencySchema,
  taxRateBp: z.number().int(),
  source: z.enum(["manual", "knowledge"]),
  kind: productKindSchema,
  status: productStatusSchema,
  description: z.string().nullable(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  trackStock: z.boolean(),
  version: z.number().int(),
  variants: z.array(variantSchema),
  media: z.array(mediaSchema),
});
export type Product = z.infer<typeof productSchema>;
export const productListSchema = z.object({ items: z.array(productSchema), nextCursor: z.string().nullable() });
export type ProductList = z.infer<typeof productListSchema>;

/** Flat per-variant row for the quote/order line picker (`GET /products/search`). */
export const productSearchItemSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  sku: z.string(),
  name: z.string(),
  unit: z.string(),
  priceMinor: z.number().int(),
  currency: currencySchema,
  taxRateBp: z.number().int(),
  source: z.enum(["manual", "knowledge"]),
  variant: z.object({ size: z.string().nullable(), color: z.string().nullable() }).nullable(),
  /** Available units; null when stock is not tracked. */
  stock: z.number().int().nullable(),
});
export type ProductSearchItem = z.infer<typeof productSearchItemSchema>;
export const productSearchListSchema = z.object({ items: z.array(productSearchItemSchema) });

export const listProductsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: productStatusSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

const moneyMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const variantInputSchema = z.object({
  /** Existing variant to update; otherwise matched by normalized options. */
  id: uuidSchema.optional(),
  /** Omitted: keeps the options of an existing variant (by id) / targets the default variant. */
  options: optionsSchema.optional(),
  sku: z.string().trim().min(1).max(100).nullable().optional(),
  priceMinor: moneyMinor.nullable().optional(),
  compareAtMinor: moneyMinor.nullable().optional(),
  stockOnHand: z.number().int().min(0).max(1_000_000).optional(),
  isActive: z.boolean().optional(),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const upsertVariantsRequestSchema = z.object({ variants: z.array(variantInputSchema).min(1).max(200) });
export type UpsertVariantsRequest = z.infer<typeof upsertVariantsRequestSchema>;

export const createProductRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  sku: z.string().trim().min(1).max(100).optional(),
  kind: productKindSchema.default("physical"),
  status: productStatusSchema.default("active"),
  category: z.string().trim().max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).default([]),
  description: z.string().trim().max(5000).optional(),
  unit: z.string().trim().min(1).max(20).optional(),
  priceMinor: moneyMinor,
  currency: currencySchema,
  taxRateBp: z.number().int().min(0).max(10_000).default(0),
  trackStock: z.boolean().optional(),
  variants: z.array(variantInputSchema).max(200).optional(),
});
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;

export const patchProductRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    sku: z.string().trim().min(1).max(100).nullable().optional(),
    kind: productKindSchema.optional(),
    status: productStatusSchema.optional(),
    category: z.string().trim().max(100).nullable().optional(),
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    unit: z.string().trim().min(1).max(20).nullable().optional(),
    priceMinor: moneyMinor.optional(),
    currency: currencySchema.optional(),
    taxRateBp: z.number().int().min(0).max(10_000).optional(),
    trackStock: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type PatchProductRequest = z.infer<typeof patchProductRequestSchema>;

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;

/** JSON body of `POST /products/:id/media` (images go as multipart `file`). */
export const videoLinkRequestSchema = z.object({
  kind: z.literal("video_link"),
  url: z
    .url()
    .max(2000)
    .refine((u) => {
      try {
        const x = new URL(u);
        return x.protocol === "https:" && x.username === "" && x.password === "";
      } catch {
        return false;
      }
    }, "Only https links are allowed"),
  variantId: uuidSchema.optional(),
  alt: z.string().trim().max(200).optional(),
});
export type VideoLinkRequest = z.infer<typeof videoLinkRequestSchema>;

export const mediaUrlResponseSchema = z.object({ url: z.string(), expiresAt: isoDateTimeSchema.nullable() });
export type MediaUrlResponse = z.infer<typeof mediaUrlResponseSchema>;

export const importFromKnowledgeRequestSchema = z.object({ sourceId: uuidSchema });
export const importFromKnowledgeResponseSchema = z.object({
  created: z.number().int(),
  skipped: z.number().int(),
  productIds: z.array(uuidSchema),
});
export type ImportFromKnowledgeResponse = z.infer<typeof importFromKnowledgeResponseSchema>;

// --- Orders -------------------------------------------------------------------------

export const orderStatusSchema = z.enum([
  "draft",
  "pending_payment",
  "paid",
  "fulfilled",
  "shipped",
  "delivered",
  "cancelled",
  "refunded",
]);
export const orderFulfillmentSchema = z.enum(["shipping", "pickup", "digital", "service"]);
export const orderStockStateSchema = z.enum(["none", "reserved", "committed", "released"]);

export const shippingAddressSchema = z.object({
  name: z.string().trim().max(200).optional(),
  line1: z.string().trim().min(1).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(20).optional(),
  country: z.string().trim().length(2).toUpperCase(),
  phone: z.string().trim().max(30).optional(),
});
export type ShippingAddress = z.infer<typeof shippingAddressSchema>;

export const orderItemSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema.nullable(),
  productId: uuidSchema.nullable(),
  description: z.string(),
  options: z.record(z.string(), z.string()),
  quantity: z.number().int(),
  unitPriceMinor: z.number().int(),
  discountBp: z.number().int(),
  taxRateBp: z.number().int(),
  lineTotalMinor: z.number().int(),
});

export const orderSchema = z.object({
  id: uuidSchema,
  number: z.string(),
  status: orderStatusSchema,
  currency: currencySchema,
  contact: contactRefSchema,
  conversationId: uuidSchema.nullable(),
  opportunityId: uuidSchema.nullable(),
  quoteId: uuidSchema.nullable(),
  fulfillment: orderFulfillmentSchema,
  shippingAddress: z.record(z.string(), z.unknown()).nullable(),
  notes: z.string().nullable(),
  items: z.array(orderItemSchema),
  subtotalMinor: z.number().int(),
  discountMinor: z.number().int(),
  shippingMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  stockState: orderStockStateSchema,
  paidAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  createdByType: z.enum(["user", "ai"]),
  lockVersion: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type Order = z.infer<typeof orderSchema>;
export const orderListSchema = z.object({ items: z.array(orderSchema), nextCursor: z.string().nullable() });
export type OrderList = z.infer<typeof orderListSchema>;

export const listOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  contactId: uuidSchema.optional(),
  cursor: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

export const createOrderRequestSchema = z
  .object({
    contactId: uuidSchema,
    conversationId: uuidSchema.optional(),
    items: z
      .array(z.object({ variantId: uuidSchema, quantity: z.number().int().min(1).max(10_000) }))
      .min(1)
      .max(100),
    fulfillment: orderFulfillmentSchema,
    shippingAddress: shippingAddressSchema.optional(),
    shippingMinor: z.number().int().min(0).max(1_000_000_000).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.fulfillment === "shipping" && !v.shippingAddress) {
      ctx.addIssue({ code: "custom", path: ["shippingAddress"], message: "shippingAddress is required for shipping" });
    }
    if (v.fulfillment !== "shipping" && (v.shippingMinor ?? 0) > 0) {
      ctx.addIssue({ code: "custom", path: ["shippingMinor"], message: "shippingMinor only applies to shipping" });
    }
  });
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

/** Manual payment: owner/admin only, reason mandatory (audited as "pago manual"). */
export const markPaidRequestSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export type MarkPaidRequest = z.infer<typeof markPaidRequestSchema>;

// --- Online payments (Stripe) --------------------------------------------------------

export const paymentStatusSchema = z.enum(["pending", "succeeded", "failed", "expired"]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** Hosted payment link for an order (Stripe Checkout Session). Amount is the server's, never the client's. */
export const paymentLinkSchema = z.object({
  paymentId: uuidSchema,
  orderId: uuidSchema,
  provider: z.enum(["stripe", "mercadopago"]),
  providerRef: z.string(),
  url: z.string().url(),
  amountMinor: z.number().int(),
  currency: currencySchema,
  status: paymentStatusSchema,
  expiresAt: isoDateTimeSchema.nullable(),
});
export type PaymentLinkResponse = z.infer<typeof paymentLinkSchema>;

export const createPaymentLinkRequestSchema = z
  .object({
    successUrl: z.string().url().startsWith("https://").max(2000).optional(),
    /** Defaults to Stripe (backwards compatible). */
    provider: z.enum(["stripe", "mercadopago"]).optional(),
  })
  .strict();
export type CreatePaymentLinkRequest = z.infer<typeof createPaymentLinkRequestSchema>;

/** BYOK Stripe credentials. Stored encrypted; never returned (only a hint). */
export const upsertStripeConnectionRequestSchema = z
  .object({
    secretKey: z.string().trim().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9]{8,250}$/, "Invalid Stripe secret key"),
    webhookSecret: z.string().trim().regex(/^whsec_[A-Za-z0-9+/=]{8,250}$/, "Invalid Stripe webhook secret"),
  })
  .strict();
export type UpsertStripeConnectionRequest = z.infer<typeof upsertStripeConnectionRequestSchema>;

export const stripeConnectionSchema = z.object({
  provider: z.literal("stripe"),
  status: z.enum(["active", "disabled"]),
  secretKeyHint: z.string().nullable(),
  webhookUrl: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type StripeConnection = z.infer<typeof stripeConnectionSchema>;

/** BYOK Mercado Pago credentials (access token + webhook signature secret). Stored encrypted. */
export const upsertMercadoPagoConnectionRequestSchema = z
  .object({
    accessToken: z.string().trim().regex(/^(APP_USR|TEST)-[A-Za-z0-9-]{10,250}$/, "Invalid Mercado Pago access token"),
    webhookSecret: z.string().trim().regex(/^[A-Za-z0-9]{16,250}$/, "Invalid Mercado Pago webhook secret"),
  })
  .strict();
export type UpsertMercadoPagoConnectionRequest = z.infer<typeof upsertMercadoPagoConnectionRequestSchema>;

export const mercadoPagoConnectionSchema = z.object({
  provider: z.literal("mercadopago"),
  status: z.enum(["active", "disabled"]),
  secretKeyHint: z.string().nullable(),
  webhookUrl: z.string(),
  updatedAt: isoDateTimeSchema,
});
export type MercadoPagoConnection = z.infer<typeof mercadoPagoConnectionSchema>;
