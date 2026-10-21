import { z } from "zod";
import { currencySchema, isoDateTimeSchema } from "./common.js";
import { metricsDaySchema } from "./metrics.js";

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

export const adReportGroupBySchema = z.enum(["campaign", "adset", "ad"]);
export type AdReportGroupBy = z.infer<typeof adReportGroupBySchema>;

export const adReportQuerySchema = z
  .object({
    from: metricsDaySchema.optional(),
    to: metricsDaySchema.optional(),
    groupBy: adReportGroupBySchema.optional(),
  })
  .strict();
export type AdReportQuery = z.infer<typeof adReportQuerySchema>;

export const adRecommendationActionSchema = z.enum(["scale", "pause", "observe"]);
export type AdRecommendationAction = z.infer<typeof adRecommendationActionSchema>;

/** Advisory only: nothing is ever changed in Meta automatically. `reason` is Spanish, with the numbers. */
export const adRecommendationSchema = z.object({
  action: adRecommendationActionSchema,
  reason: z.string(),
});
export type AdRecommendation = z.infer<typeof adRecommendationSchema>;

export const adReportRowSchema = z.object({
  /** Group key: ad id, adset id or campaign id; "unknown" groups rows without that id. */
  sourceId: z.string(),
  level: adReportGroupBySchema,
  /** Display name (Meta name, manual label or the ad headline). */
  label: z.string().nullable(),
  headline: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  campaignName: z.string().nullable(),
  adsetName: z.string().nullable(),
  conversations: z.number().int().min(0),
  orders: z.number().int().min(0),
  paidOrders: z.number().int().min(0),
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  /** "daily" = synced from Meta for the range; "manual" = undated manual total; null = no spend. */
  spendSource: z.enum(["daily", "manual", "mixed"]).nullable(),
  /**
   * Per currency; revenue counts only orders paid with verified_by webhook | reconciliation.
   * Spend and revenue in different currencies stay on separate lines (no ROAS, never converted).
   */
  byCurrency: z.array(
    adRoasSchema.extend({
      costPerConversationMinor: moneyMinor.nullable(),
      costPerPurchaseMinor: moneyMinor.nullable(),
    }),
  ),
  recommendation: adRecommendationSchema,
});
export type AdReportRow = z.infer<typeof adReportRowSchema>;

export const adReportSchema = z.object({
  from: metricsDaySchema,
  to: metricsDaySchema,
  groupBy: adReportGroupBySchema,
  items: z.array(adReportRowSchema),
});
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

// --- Meta Marketing API (automatic spend sync) ------------------------------------------------

/** AAD purpose of the encrypted Marketing API (ads_read) access token (shared by api and worker). */
export const META_ADS_TOKEN_PURPOSE = "meta_ads_access_token";
/** BullMQ queue / job names shared by api ("Sincronizar ahora") and worker. */
export const META_ADS_QUEUE_NAME = "meta-ads";
export const META_ADS_SYNC_TENANT_JOB = "meta-ads-sync-tenant";
/**
 * Graph API version of the Marketing API calls made by the api (ad account listing). Must equal
 * META_GRAPH_API_VERSION in apps/worker/src/meta-capi/client.ts (asserted by a worker test).
 */
export const META_ADS_GRAPH_API_VERSION = "v23.0";

export const metaAdAccountIdSchema = z.string().trim().regex(/^act_\d{1,32}$/, "Ad account id: act_<digits>");
const metaAccessTokenSchema = z.string().trim().min(20).max(1000);

export const listMetaAdAccountsRequestSchema = z
  .object({
    /** Optional: when omitted the stored token is used. */
    accessToken: metaAccessTokenSchema.optional(),
  })
  .strict();
export type ListMetaAdAccountsRequest = z.infer<typeof listMetaAdAccountsRequestSchema>;

export const metaAdAccountSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  currency: z.string().nullable(),
  active: z.boolean(),
});
export type MetaAdAccount = z.infer<typeof metaAdAccountSchema>;
export const metaAdAccountsSchema = z.object({ items: z.array(metaAdAccountSchema) });
export type MetaAdAccounts = z.infer<typeof metaAdAccountsSchema>;

export const upsertMetaAdsRequestSchema = z
  .object({
    adAccountId: metaAdAccountIdSchema,
    adAccountName: z.string().trim().max(200).nullable().optional(),
    currency: currencySchema.nullable().optional(),
    /** Optional on update: keeps the stored token. Required on first save (checked server-side). */
    accessToken: metaAccessTokenSchema.optional(),
  })
  .strict();
export type UpsertMetaAdsRequest = z.infer<typeof upsertMetaAdsRequestSchema>;

/** Recommendation thresholds. ROAS as a decimal multiple (3 = 3.00x); money in account-currency minor units. */
export const adRecommendationSettingsSchema = z
  .object({
    targetRoas: z.number().positive().max(1000),
    breakEvenRoas: z.number().positive().max(1000),
    minSpendMinor: moneyMinor,
    minConversations: z.number().int().min(0).max(1_000_000),
    pauseSpendMinor: moneyMinor,
  })
  .strict()
  .refine((s) => s.breakEvenRoas <= s.targetRoas, { message: "Break-even ROAS must not exceed the target ROAS", path: ["breakEvenRoas"] });
export type AdRecommendationSettings = z.infer<typeof adRecommendationSettingsSchema>;

export const metaAdsConnectionSchema = z.object({
  adAccountId: z.string(),
  adAccountName: z.string().nullable(),
  currency: z.string().nullable(),
  status: z.enum(["active", "disabled"]),
  tokenHint: z.string().nullable(),
  lastSyncAt: isoDateTimeSchema.nullable(),
  lastSyncStatus: z.enum(["ok", "error"]).nullable(),
  lastSyncError: z.string().nullable(),
  updatedAt: isoDateTimeSchema,
});
export type MetaAdsConnectionView = z.infer<typeof metaAdsConnectionSchema>;

export const metaAdsStateSchema = z.object({
  connection: metaAdsConnectionSchema.nullable(),
  settings: adRecommendationSettingsSchema,
});
export type MetaAdsState = z.infer<typeof metaAdsStateSchema>;
