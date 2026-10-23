import { z } from "zod";

/*
 * Gupshup inbound callback schemas.
 *
 * Sources:
 * - https://docs.gupshup.io/docs/types-of-payloads  (Gupshup "v2" callback format: type "message" / "message-event")
 * - https://docs.gupshup.io/docs/inbound-messages    (inbound message structure, sender object, ms timestamps)
 * - https://docs.gupshup.io/docs/session-messages    (send API)
 * - https://docs.gupshup.io/docs/template-messages   (template send API)
 * Gupshup apps can also be configured for the "v3" format, which forwards Meta's
 * WhatsApp Business webhook body unchanged (object "whatsapp_business_account").
 * Both shapes are accepted. Schemas are permissive on extra keys (BSPs add fields
 * over time) but strict on the fields we rely on.
 */

const idSchema = z.string().min(1).max(256);
const phoneDigitsSchema = z.string().regex(/^\+?[1-9]\d{1,14}$/);

// ---------- Click-to-WhatsApp referral ----------

/**
 * Meta `referral` object (https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples#click-to-whatsapp-ads).
 * v3 forwards it unchanged on `messages[]`; Gupshup v2 carries the same keys under the message
 * payload (`payload.referral`, or inside the content `payload.payload.referral`). Every field is
 * optional and length-capped; unknown keys are ignored.
 */
const refStr = (max: number) => z.string().max(max).optional();
export const referralSchema = z
  .object({
    source_url: refStr(2048),
    source_id: refStr(256),
    source_type: refStr(64),
    headline: refStr(1024),
    body: refStr(4096),
    media_type: refStr(64),
    ctwa_clid: refStr(1024),
  })
  .loose();
export type Referral = z.infer<typeof referralSchema>;

// ---------- v2 ----------

export const v2SenderSchema = z.object({
  phone: phoneDigitsSchema,
  name: z.string().optional(),
  country_code: z.string().optional(),
  dial_code: z.string().optional(),
});

export const v2InboundMessageSchema = z.object({
  app: z.string().optional(),
  timestamp: z.number().int().positive(),
  version: z.number().optional(),
  type: z.literal("message"),
  payload: z.object({
    id: idSchema,
    source: phoneDigitsSchema,
    type: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
    sender: v2SenderSchema.optional(),
    destination: z.string().optional(),
    referral: z.unknown().optional(),
  }),
});
export type V2InboundMessage = z.infer<typeof v2InboundMessageSchema>;

export const v2TextPayloadSchema = z.object({ text: z.string() });
export const v2MediaPayloadSchema = z.object({
  url: z.string().url().optional(),
  contentType: z.string().optional(),
  caption: z.string().optional(),
  name: z.string().optional(),
  urlExpiry: z.number().optional(),
});
export const v2LocationPayloadSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
});
export const v2InteractivePayloadSchema = z.object({
  title: z.string().optional(),
  id: z.string().optional(),
  reply: z.string().optional(),
  postbackText: z.string().optional(),
});

/** Inbound reaction content. Field names vary between payload versions, so several are accepted. */
export const v2ReactionPayloadSchema = z
  .object({
    emoji: z.string().max(32).optional(),
    msgId: idSchema.optional(),
    messageId: idSchema.optional(),
    message_id: idSchema.optional(),
    id: idSchema.optional(),
    reactedMessageId: idSchema.optional(),
  })
  .loose();

export const v2MessageEventSchema = z.object({
  app: z.string().optional(),
  timestamp: z.number().int().positive(),
  version: z.number().optional(),
  type: z.literal("message-event"),
  payload: z.object({
    id: idSchema,
    gsId: idSchema.optional(),
    type: z.enum(["enqueued", "sent", "delivered", "read", "failed", "deleted", "mismatch"]),
    destination: z.string().optional(),
    payload: z
      .object({
        code: z.union([z.number(), z.string()]).optional(),
        reason: z.string().optional(),
        whatsappMessageId: z.string().optional(),
        ts: z.number().optional(),
      })
      .loose()
      .optional(),
  }),
});
export type V2MessageEvent = z.infer<typeof v2MessageEventSchema>;

// ---------- v3 (Meta passthrough) ----------

const v3MediaSchema = z.object({
  id: idSchema,
  mime_type: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  url: z.string().url().optional(),
});

export const v3MessageSchema = z.object({
  id: idSchema,
  from: phoneDigitsSchema,
  timestamp: z.string().regex(/^\d+$/),
  type: z.string().min(1),
  text: z.object({ body: z.string() }).optional(),
  image: v3MediaSchema.optional(),
  audio: v3MediaSchema.optional(),
  video: v3MediaSchema.optional(),
  document: v3MediaSchema.optional(),
  location: v2LocationPayloadSchema.optional(),
  interactive: z
    .object({
      type: z.string(),
      button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
      list_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    })
    .optional(),
  button: z.object({ text: z.string(), payload: z.string().optional() }).optional(),
  reaction: z.object({ message_id: idSchema, emoji: z.string().max(32).optional() }).loose().optional(),
  referral: z.unknown().optional(),
});
export type V3Message = z.infer<typeof v3MessageSchema>;

export const v3StatusSchema = z.object({
  id: idSchema,
  gs_id: idSchema.optional(),
  status: z.enum(["sent", "delivered", "read", "failed", "deleted"]),
  timestamp: z.string().regex(/^\d+$/),
  recipient_id: z.string().optional(),
  errors: z
    .array(z.object({ code: z.union([z.number(), z.string()]), title: z.string().optional(), message: z.string().optional() }))
    .optional(),
});
export type V3Status = z.infer<typeof v3StatusSchema>;

export const v3EnvelopeSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(
    z.object({
      changes: z.array(
        z.object({
          field: z.string().optional(),
          value: z
            .object({
              metadata: z.object({ display_phone_number: z.string().optional() }).loose().optional(),
              contacts: z.array(z.object({ wa_id: z.string(), profile: z.object({ name: z.string() }).optional() })).optional(),
              messages: z.array(z.unknown()).optional(),
              statuses: z.array(z.unknown()).optional(),
            })
            .loose(),
        }),
      ),
    }),
  ),
});

// ---------- send API response ----------

// ---------- Templates (Partner API: /partner/app/{appId}/templates, partner app token) ----------

const templateRowSchema = z
  .object({
    id: z.string().min(1).max(256),
    elementName: z.string().min(1).max(512),
    languageCode: z.string().min(2).max(16),
    category: z.string().max(64).optional(),
    status: z.string().max(64).optional(),
    data: z.string().max(4096).optional(),
    reason: z.string().max(1024).nullish(),
  })
  .loose();
export type GupshupTemplateRow = z.infer<typeof templateRowSchema>;

export const templateListResponseSchema = z.object({
  status: z.string(),
  templates: z.array(templateRowSchema).default([]),
});

export const templateSubmitResponseSchema = z.object({
  status: z.string(),
  template: templateRowSchema.optional(),
});

export const sendResponseSchema = z.object({
  status: z.string(),
  messageId: z.string().min(1).optional(),
  message: z.string().optional(),
});
