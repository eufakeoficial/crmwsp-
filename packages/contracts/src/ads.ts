import { z } from "zod";
import { currencySchema, isoDateTimeSchema } from "./common.js";

// --- Click-to-WhatsApp ads: attribution report and manual spend ------------------------------

/** Meta ad id as received in the referral `source_id`. */
export const adSourceIdSchema = z.string().trim().min(1).max(256);

const moneyMinor = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const upsertAdSpendRequestSchema = z
  .object({
    sourceId: adSourceIdSchema,
    currency: currencySchema,
    amountMinor: moneyMinor,
    label: z.string().trim().max(200).optional(),
  })
  .strict();
export type UpsertAdSpendRequest = z.infer<typeof upsertAdSpendRequestSchema>;

export const adRoasSchema = z.object({
  currency: currencySchema,
  revenueMinor: moneyMinor,
  spendMinor: moneyMinor,
  roas: z.number().nullable(),
});

export const adReportRowSchema = z.object({
  /** Ad id; "unknown" groups click-id-only attributions. */
  sourceId: z.string(),
  label: z.string().nullable(),
  headline: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  conversations: z.number().int().min(0),
  orders: z.number().int().min(0),
  paidOrders: z.number().int().min(0),
  /** Per currency; revenue counts only orders paid with verified_by webhook | reconciliation. */
  byCurrency: z.array(adRoasSchema),
});
export type AdReportRow = z.infer<typeof adReportRowSchema>;

export const adReportSchema = z.object({ items: z.array(adReportRowSchema) });
export type AdReport = z.infer<typeof adReportSchema>;

// --- Meta Conversions API ---------------------------------------------------------------------

export const upsertMetaCapiRequestSchema = z
  .object({
    datasetId: z.string().trim().regex(/^\d{5,32}$/, "Pixel / dataset id: digits only"),
    /** Optional on update: keeps the stored token. Required on first save (checked server-side). */
    accessToken: z.string().trim().min(20).max(1000).optional(),
    testEventCode: z.string().trim().max(64).nullable().optional(),
  })
  .strict();
export type UpsertMetaCapiRequest = z.infer<typeof upsertMetaCapiRequestSchema>;

export const metaCapiConnectionSchema = z.object({
  datasetId: z.string(),
  status: z.enum(["active", "disabled"]),
  tokenHint: z.string().nullable(),
  testEventCode: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
  sent: z.number().int().min(0),
  pending: z.number().int().min(0),
  dead: z.number().int().min(0),
});
export type MetaCapiConnectionView = z.infer<typeof metaCapiConnectionSchema>;

export const metaCapiStateSchema = z.object({ connection: metaCapiConnectionSchema.nullable() });
export type MetaCapiState = z.infer<typeof metaCapiStateSchema>;

/** AAD purpose of the encrypted Conversions API access token (shared by api and worker). */
export const META_CAPI_TOKEN_PURPOSE = "meta_capi_access_token";
