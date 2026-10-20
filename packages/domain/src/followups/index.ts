import {
  followUpSettingsSchema,
  type FollowUpSettings,
  type PatchFollowUpSettingsRequest,
} from "@crmwsp/contracts";

/** WhatsApp customer-service window: free text only within 24 h of the contact's last message. */
export const WHATSAPP_WINDOW_MS = 24 * 3600 * 1000;

export const DEFAULT_FOLLOW_UP_SETTINGS: FollowUpSettings = {
  leadStalled: {
    enabled: false,
    delayHours: 2,
    message: "Hi! Just checking in: do you have any other questions? We are happy to help.",
    templateId: null,
  },
  orderPendingPayment: {
    enabled: false,
    delayHours: 24,
    message: "Hi! Your order is still waiting for payment. Do you need help completing it?",
    templateId: null,
  },
  quietHours: null,
};

/** Reads `tenants.settings.followUps`, falling back to defaults for anything missing or invalid. */
export function resolveFollowUpSettings(raw: unknown): FollowUpSettings {
  const r = (raw ?? {}) as Partial<Record<keyof FollowUpSettings, unknown>>;
  const merged = {
    leadStalled: { ...DEFAULT_FOLLOW_UP_SETTINGS.leadStalled, ...(isObj(r.leadStalled) ? r.leadStalled : {}) },
    orderPendingPayment: {
      ...DEFAULT_FOLLOW_UP_SETTINGS.orderPendingPayment,
      ...(isObj(r.orderPendingPayment) ? r.orderPendingPayment : {}),
    },
    quietHours: r.quietHours === undefined ? DEFAULT_FOLLOW_UP_SETTINGS.quietHours : r.quietHours,
  };
  const parsed = followUpSettingsSchema.safeParse(merged);
  return parsed.success ? parsed.data : DEFAULT_FOLLOW_UP_SETTINGS;
}

export function mergeFollowUpSettings(current: FollowUpSettings, patch: PatchFollowUpSettingsRequest): FollowUpSettings {
  return followUpSettingsSchema.parse({
    leadStalled: { ...current.leadStalled, ...(patch.leadStalled ?? {}) },
    orderPendingPayment: { ...current.orderPendingPayment, ...(patch.orderPendingPayment ?? {}) },
    quietHours: patch.quietHours === undefined ? current.quietHours : patch.quietHours,
  });
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isWindowOpen(lastInboundAt: Date | null, now: Date): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}

/** Minutes since local midnight in `timeZone`. */
function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h * 60 + m;
}

const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * When `now` falls in quiet hours (tenant-local, may wrap midnight), returns the instant they end;
 * otherwise null. Precision is one minute; DST jumps can shift the result by the jump size.
 */
export function quietHoursEnd(
  quiet: FollowUpSettings["quietHours"],
  now: Date,
  timeZone: string,
): Date | null {
  if (!quiet) return null;
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);
  if (start === end) return null;
  const cur = localMinutes(now, timeZone);
  const inside = start < end ? cur >= start && cur < end : cur >= start || cur < end;
  if (!inside) return null;
  const wait = (end - cur + 24 * 60) % (24 * 60);
  const at = new Date(now.getTime() + wait * 60_000);
  at.setUTCSeconds(0, 0);
  return at;
}

export type ConsentState = "granted" | "revoked" | "unknown";

export interface DispatchInput {
  now: Date;
  status: string;
  scheduledAt: Date;
  createdAt: Date;
  /** Last inbound message of the conversation. */
  lastInboundAt: Date | null;
  conversationResolved: boolean;
  /** `follow_up` consent of the contact. */
  consent: ConsentState;
  messageBody: string | null;
  /** Template already validated as approved and on the conversation's channel; null otherwise. */
  approvedTemplate: { id: string; body: string } | null;
  /** Order status when the follow-up targets an order. */
  orderStatus: string | null;
  quietHours: FollowUpSettings["quietHours"];
  timeZone: string;
}

export type DispatchDecision =
  | { action: "send_text"; body: string }
  | { action: "send_template"; templateId: string; body: string }
  | { action: "defer"; until: Date }
  | { action: "cancel"; reason: string }
  | { action: "skip"; reason: string }
  | { action: "noop" };

/**
 * Pure decision for one due follow-up. Order: not-pending → noop; contact replied or order no
 * longer awaiting payment → cancel; opt-out → skip; quiet hours → defer; window open → free text;
 * window closed → approved template with explicit consent, else skip.
 */
export function decideDispatch(i: DispatchInput): DispatchDecision {
  if (i.status !== "scheduled" || i.scheduledAt.getTime() > i.now.getTime()) return { action: "noop" };
  if (i.lastInboundAt && i.lastInboundAt.getTime() > i.createdAt.getTime()) {
    return { action: "cancel", reason: "contact_replied" };
  }
  if (i.orderStatus !== null && i.orderStatus !== "pending_payment") {
    return { action: "cancel", reason: `order_${i.orderStatus}` };
  }
  if (i.conversationResolved) return { action: "cancel", reason: "conversation_resolved" };
  if (i.consent === "revoked") return { action: "skip", reason: "consent_revoked" };
  const until = quietHoursEnd(i.quietHours, i.now, i.timeZone);
  if (until) return { action: "defer", until };
  if (isWindowOpen(i.lastInboundAt, i.now)) {
    if (i.messageBody) return { action: "send_text", body: i.messageBody };
    if (i.approvedTemplate) return { action: "send_template", templateId: i.approvedTemplate.id, body: i.approvedTemplate.body };
    return { action: "skip", reason: "no_message" };
  }
  if (!i.approvedTemplate) return { action: "skip", reason: "window_closed_no_template" };
  if (i.consent !== "granted") return { action: "skip", reason: "window_closed_no_consent" };
  return { action: "send_template", templateId: i.approvedTemplate.id, body: i.approvedTemplate.body };
}

/** Stable dedupe keys: one automatic follow-up per triggering message / order. */
export const leadStalledKey = (messageId: string): string => `lead_stalled:${messageId}`;
export const orderPendingKey = (orderId: string): string => `order_pending_payment:${orderId}`;
