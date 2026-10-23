import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOLLOW_UP_SETTINGS,
  decideDispatch,
  isWindowOpen,
  mergeFollowUpSettings,
  quietHoursEnd,
  quoteUnansweredKey,
  resolveFollowUpSettings,
  type DispatchInput,
} from "./index.js";

const now = new Date("2026-10-20T12:00:00Z");
const h = (n: number): Date => new Date(now.getTime() - n * 3600_000);

const base = (o: Partial<DispatchInput> = {}): DispatchInput => ({
  now,
  status: "scheduled",
  scheduledAt: h(0.1),
  createdAt: h(3),
  lastInboundAt: h(4),
  conversationResolved: false,
  consent: "unknown",
  messageBody: "hello",
  approvedTemplate: null,
  orderStatus: null,
  quietHours: null,
  timeZone: "UTC",
  ...o,
});

describe("24h window", () => {
  it("is open just under 24h and closed at 24h", () => {
    expect(isWindowOpen(h(23.9), now)).toBe(true);
    expect(isWindowOpen(h(24), now)).toBe(false);
    expect(isWindowOpen(null, now)).toBe(false);
  });
  it("sends free text inside the window", () => {
    expect(decideDispatch(base())).toEqual({ action: "send_text", body: "hello" });
  });
  it("skips outside the window without an approved template", () => {
    expect(decideDispatch(base({ lastInboundAt: h(30), createdAt: h(29) }))).toEqual({
      action: "skip",
      reason: "window_closed_no_template",
    });
  });
  it("uses the template outside the window only with granted consent", () => {
    const t = { id: "tpl", body: "Hi {{1}}" };
    expect(decideDispatch(base({ lastInboundAt: h(30), approvedTemplate: t }))).toEqual({
      action: "skip",
      reason: "window_closed_no_consent",
    });
    expect(decideDispatch(base({ lastInboundAt: h(30), approvedTemplate: t, consent: "granted" }))).toEqual({
      action: "send_template",
      templateId: "tpl",
      body: "Hi {{1}}",
    });
  });
});

describe("consent and cancellation", () => {
  it("skips when the contact opted out, even inside the window", () => {
    expect(decideDispatch(base({ consent: "revoked" }))).toEqual({ action: "skip", reason: "consent_revoked" });
  });
  it("cancels when the contact replied after the follow-up was created", () => {
    expect(decideDispatch(base({ lastInboundAt: h(1) }))).toEqual({ action: "cancel", reason: "contact_replied" });
  });
  it("cancels an order follow-up once the order is paid", () => {
    expect(decideDispatch(base({ orderStatus: "paid" }))).toEqual({ action: "cancel", reason: "order_paid" });
    expect(decideDispatch(base({ orderStatus: "pending_payment" })).action).toBe("send_text");
  });
});

describe("idempotency", () => {
  it("is a noop for anything not scheduled or not yet due (retry after send)", () => {
    for (const status of ["sent", "skipped", "cancelled", "suggested"]) {
      expect(decideDispatch(base({ status }))).toEqual({ action: "noop" });
    }
    expect(decideDispatch(base({ scheduledAt: new Date(now.getTime() + 60_000) }))).toEqual({ action: "noop" });
  });
});

describe("quiet hours", () => {
  it("defers to the end of a window that wraps midnight", () => {
    const at = new Date("2026-10-20T22:30:00Z");
    expect(quietHoursEnd({ start: "21:00", end: "09:00" }, at, "UTC")?.toISOString()).toBe("2026-10-21T09:00:00.000Z");
    expect(quietHoursEnd({ start: "21:00", end: "09:00" }, now, "UTC")).toBeNull();
  });
  it("uses the tenant timezone", () => {
    // 12:00Z is 14:00 in Madrid (CEST).
    const end = quietHoursEnd({ start: "13:00", end: "15:00" }, now, "Europe/Madrid");
    expect(end?.toISOString()).toBe("2026-10-20T13:00:00.000Z");
    expect(decideDispatch(base({ quietHours: { start: "13:00", end: "15:00" }, timeZone: "Europe/Madrid" })).action).toBe("defer");
  });
});

describe("settings", () => {
  it("falls back to defaults (2h lead, 24h order) and merges patches", () => {
    const s = resolveFollowUpSettings({ leadStalled: { enabled: true }, quietHours: "bad" });
    expect(s).toEqual(DEFAULT_FOLLOW_UP_SETTINGS);
    const ok = resolveFollowUpSettings({ leadStalled: { enabled: true } });
    expect(ok.leadStalled).toMatchObject({ enabled: true, delayHours: 2 });
    expect(ok.orderPendingPayment.delayHours).toBe(24);
    expect(mergeFollowUpSettings(ok, { orderPendingPayment: { delayHours: 6 } }).orderPendingPayment.delayHours).toBe(6);
  });
});

describe("quote_unanswered", () => {
  const q = (o: Partial<DispatchInput> = {}): DispatchInput =>
    base({ quoteStatus: "sent", quoteValidUntil: new Date(now.getTime() + 86_400_000), ...o });

  it("defaults to disabled with a 48h delay", () => {
    expect(DEFAULT_FOLLOW_UP_SETTINGS.quoteUnanswered).toMatchObject({ enabled: false, delayHours: 48, templateId: null });
    expect(resolveFollowUpSettings(undefined).quoteUnanswered.delayHours).toBe(48);
  });
  it("merges a per-tenant delay and ignores invalid values", () => {
    const s = resolveFollowUpSettings({ quoteUnanswered: { enabled: true, delayHours: 72 } });
    expect(s.quoteUnanswered).toMatchObject({ enabled: true, delayHours: 72 });
    expect(resolveFollowUpSettings({ quoteUnanswered: { delayHours: 0 } }).quoteUnanswered.delayHours).toBe(48);
    expect(mergeFollowUpSettings(s, { quoteUnanswered: { delayHours: 24 } }).quoteUnanswered.delayHours).toBe(24);
  });
  it("sends free text inside the window while the quote is still sent", () => {
    expect(decideDispatch(q())).toEqual({ action: "send_text", body: "hello" });
  });
  it("cancels when the quote was accepted, rejected, expired or cancelled", () => {
    for (const st of ["accepted", "rejected", "expired", "cancelled"]) {
      expect(decideDispatch(q({ quoteStatus: st }))).toEqual({ action: "cancel", reason: `quote_${st}` });
    }
  });
  it("cancels once valid_until has passed even if the status is still sent", () => {
    expect(decideDispatch(q({ quoteValidUntil: h(1) }))).toEqual({ action: "cancel", reason: "quote_expired" });
  });
  it("cancels when the contact replied after the follow-up was created", () => {
    expect(decideDispatch(q({ lastInboundAt: h(1) }))).toEqual({ action: "cancel", reason: "contact_replied" });
  });
  it("respects consent and the 24h window rules", () => {
    expect(decideDispatch(q({ consent: "revoked" }))).toEqual({ action: "skip", reason: "consent_revoked" });
    expect(decideDispatch(q({ lastInboundAt: h(30) }))).toEqual({
      action: "skip",
      reason: "window_closed_no_template",
    });
    const tpl = { id: "t1", body: "tpl" };
    expect(decideDispatch(q({ lastInboundAt: h(30), approvedTemplate: tpl }))).toEqual({
      action: "skip",
      reason: "window_closed_no_consent",
    });
    expect(decideDispatch(q({ lastInboundAt: h(30), approvedTemplate: tpl, consent: "granted" }))).toEqual({
      action: "send_template",
      templateId: "t1",
      body: "tpl",
    });
  });
  it("builds a stable dedupe key per quote", () => {
    expect(quoteUnansweredKey("abc")).toBe("quote_unanswered:abc");
  });
});
