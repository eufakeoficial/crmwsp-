import { e164PhoneSchema } from "@crmwsp/contracts";
import type { DeliveryStatus, InboundWebhookResult, NormalizedInboundMessage } from "../types.js";
import {
  v2InboundMessageSchema,
  v2InteractivePayloadSchema,
  v2LocationPayloadSchema,
  v2MediaPayloadSchema,
  v2MessageEventSchema,
  v2TextPayloadSchema,
  v3EnvelopeSchema,
  v3MessageSchema,
  v3StatusSchema,
  type V2InboundMessage,
  type V3Message,
} from "./schemas.js";

export const messageDedupeKey = (externalId: string) => `msg:${externalId}`;
export const statusDedupeKey = (externalId: string, status: DeliveryStatus) => `status:${externalId}:${status}`;

/** Gupshup sends phones as bare digits ("919876543210"); normalize to E.164. */
export function toE164(phone: string): string | undefined {
  const candidate = phone.startsWith("+") ? phone : `+${phone}`;
  return e164PhoneSchema.safeParse(candidate).success ? candidate : undefined;
}

const ignored = (reason: string): InboundWebhookResult => ({ kind: "ignored", reason });

/** Entry point. Never throws. */
export function parseGupshupWebhook(body: unknown): InboundWebhookResult[] {
  try {
    if (typeof body !== "object" || body === null) return [ignored("non-object body")];
    const record = body as Record<string, unknown>;
    if (record.object === "whatsapp_business_account") return parseV3(body);
    switch (record.type) {
      case "message":
        return [parseV2Message(body)];
      case "message-event":
        return [parseV2Event(body)];
      case "user-event":
      case "billing-event":
      case "system-event":
        return [ignored(`unhandled gupshup event type: ${record.type}`)];
      default:
        return [ignored("unknown payload shape")];
    }
  } catch {
    return [ignored("parse error")];
  }
}

function parseV2Message(body: unknown): InboundWebhookResult {
  const parsed = v2InboundMessageSchema.safeParse(body);
  if (!parsed.success) return ignored("invalid gupshup message payload");
  const p = parsed.data.payload;
  const from = toE164(p.source);
  if (!from) return ignored("invalid sender phone");

  const message: NormalizedInboundMessage = {
    externalId: p.id,
    from,
    timestamp: new Date(parsed.data.timestamp),
    type: "unsupported",
    raw: body,
  };
  if (p.sender?.name) message.contactName = p.sender.name;
  const to = p.destination ? toE164(p.destination) : undefined;
  if (to) message.to = to;
  fillV2Content(message, p);
  return { kind: "message", dedupeKey: messageDedupeKey(p.id), message };
}

function fillV2Content(message: NormalizedInboundMessage, p: V2InboundMessage["payload"]): void {
  switch (p.type) {
    case "text": {
      const t = v2TextPayloadSchema.safeParse(p.payload);
      if (t.success) {
        message.type = "text";
        message.text = t.data.text;
      }
      return;
    }
    case "image":
    case "audio":
    case "video":
    case "file":
    case "document": {
      const m = v2MediaPayloadSchema.safeParse(p.payload);
      if (!m.success) return;
      message.type = p.type === "file" ? "document" : p.type;
      message.media = {};
      if (m.data.url) message.media.url = m.data.url;
      if (m.data.contentType) message.media.mimeType = m.data.contentType;
      if (m.data.caption) message.media.caption = m.data.caption;
      if (m.data.name) message.media.filename = m.data.name;
      return;
    }
    case "location": {
      const l = v2LocationPayloadSchema.safeParse(p.payload);
      if (!l.success) return;
      message.type = "location";
      message.location = { latitude: l.data.latitude, longitude: l.data.longitude };
      if (l.data.name) message.location.name = l.data.name;
      if (l.data.address) message.location.address = l.data.address;
      return;
    }
    case "button_reply":
    case "list_reply":
    case "quick_reply": {
      const i = v2InteractivePayloadSchema.safeParse(p.payload);
      if (!i.success) return;
      message.type = "interactive";
      const text = i.data.title ?? i.data.reply ?? i.data.postbackText;
      if (text !== undefined) message.text = text;
      return;
    }
    default:
      return; // stays "unsupported" (contacts, stickers, reactions, ...)
  }
}

const v2StatusMap: Record<string, DeliveryStatus | undefined> = {
  enqueued: "queued",
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

function parseV2Event(body: unknown): InboundWebhookResult {
  const parsed = v2MessageEventSchema.safeParse(body);
  if (!parsed.success) return ignored("invalid gupshup message-event payload");
  const p = parsed.data.payload;
  const status = v2StatusMap[p.type];
  if (!status) return ignored(`unhandled message-event: ${p.type}`);
  // For "enqueued", `id` is the Gupshup id; later events carry the WhatsApp id in
  // `id` and the Gupshup id in `gsId`. The send API returns the Gupshup id, so prefer it.
  const externalId = p.gsId ?? p.id;
  const result: InboundWebhookResult = {
    kind: "status",
    dedupeKey: statusDedupeKey(externalId, status),
    status: { externalId, status, timestamp: new Date(p.payload?.ts ? p.payload.ts * 1000 : parsed.data.timestamp) },
  };
  if (status === "failed") {
    result.status.error = {
      code: p.payload?.code !== undefined ? String(p.payload.code) : "unknown",
      message: p.payload?.reason ?? "unknown error",
    };
  }
  return result;
}

function parseV3(body: unknown): InboundWebhookResult[] {
  const env = v3EnvelopeSchema.safeParse(body);
  if (!env.success) return [ignored("invalid v3 envelope")];
  const out: InboundWebhookResult[] = [];
  for (const entry of env.data.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const to = value.metadata?.display_phone_number ? toE164(value.metadata.display_phone_number) : undefined;
      for (const rawMsg of value.messages ?? []) {
        const m = v3MessageSchema.safeParse(rawMsg);
        if (!m.success) {
          out.push(ignored("invalid v3 message"));
          continue;
        }
        const from = toE164(m.data.from);
        if (!from) {
          out.push(ignored("invalid sender phone"));
          continue;
        }
        const message: NormalizedInboundMessage = {
          externalId: m.data.id,
          from,
          timestamp: new Date(Number(m.data.timestamp) * 1000),
          type: "unsupported",
          raw: rawMsg,
        };
        if (to) message.to = to;
        const name = value.contacts?.find((c) => c.wa_id === m.data.from)?.profile?.name;
        if (name) message.contactName = name;
        fillV3Content(message, m.data);
        out.push({ kind: "message", dedupeKey: messageDedupeKey(m.data.id), message });
      }
      for (const rawStatus of value.statuses ?? []) {
        const s = v3StatusSchema.safeParse(rawStatus);
        if (!s.success || s.data.status === "deleted") {
          out.push(ignored("invalid or unhandled v3 status"));
          continue;
        }
        const externalId = s.data.gs_id ?? s.data.id;
        const status = s.data.status;
        const r: InboundWebhookResult = {
          kind: "status",
          dedupeKey: statusDedupeKey(externalId, status),
          status: { externalId, status, timestamp: new Date(Number(s.data.timestamp) * 1000) },
        };
        const err = s.data.errors?.[0];
        if (status === "failed") {
          r.status.error = {
            code: err ? String(err.code) : "unknown",
            message: err?.message ?? err?.title ?? "unknown error",
          };
        }
        out.push(r);
      }
    }
  }
  return out.length > 0 ? out : [ignored("empty v3 envelope")];
}

function fillV3Content(message: NormalizedInboundMessage, m: V3Message): void {
  switch (m.type) {
    case "text":
      if (m.text) {
        message.type = "text";
        message.text = m.text.body;
      }
      return;
    case "image":
    case "audio":
    case "video":
    case "document": {
      const media = m[m.type];
      if (!media) return;
      message.type = m.type;
      message.media = { externalMediaId: media.id };
      if (media.url) message.media.url = media.url;
      if (media.mime_type) message.media.mimeType = media.mime_type;
      if (media.caption) message.media.caption = media.caption;
      if (media.filename) message.media.filename = media.filename;
      return;
    }
    case "location":
      if (m.location) {
        message.type = "location";
        message.location = { latitude: m.location.latitude, longitude: m.location.longitude };
        if (m.location.name) message.location.name = m.location.name;
        if (m.location.address) message.location.address = m.location.address;
      }
      return;
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      if (reply) {
        message.type = "interactive";
        message.text = reply.title;
      }
      return;
    }
    case "button":
      if (m.button) {
        message.type = "interactive";
        message.text = m.button.text;
      }
      return;
    default:
      return;
  }
}
