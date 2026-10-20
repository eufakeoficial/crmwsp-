import { describe, expect, it } from "vitest";
import { dispatchDue, type DueFollowUp, type FollowUpStore } from "../followups/engine.js";

const now = new Date("2026-10-20T12:00:00Z");
const ago = (h: number): Date => new Date(now.getTime() - h * 3600_000);

/** In-memory store mirroring the Postgres adapter's guards (status = 'scheduled', keyed insert). */
function fakeStore(rows: DueFollowUp[]) {
  const messages = new Map<string, { id: string; kind: string; body: string }>();
  const store: FollowUpStore & { rows: DueFollowUp[]; messages: typeof messages; reasons: Map<string, string> } = {
    rows,
    messages,
    reasons: new Map(),
    async lockDue(at, limit) {
      return rows.filter((r) => r.status === "scheduled" && r.scheduledAt <= at).slice(0, limit).map((r) => ({ ...r }));
    },
    async insertQueuedMessage(f, kind, body) {
      const existing = messages.get(f.id);
      if (existing) return existing.id;
      const m = { id: `msg-${f.id}`, kind, body };
      messages.set(f.id, m);
      return m.id;
    },
    async markSent(id) {
      const r = rows.find((x) => x.id === id);
      if (r?.status === "scheduled") r.status = "sent";
    },
    async markSkipped(id, reason) {
      const r = rows.find((x) => x.id === id);
      if (r?.status === "scheduled") {
        r.status = "skipped";
        store.reasons.set(id, reason);
      }
    },
    async markCancelled(id, reason) {
      const r = rows.find((x) => x.id === id);
      if (r?.status === "scheduled") {
        r.status = "cancelled";
        store.reasons.set(id, reason);
      }
    },
    async defer(id, until) {
      const r = rows.find((x) => x.id === id);
      if (r?.status === "scheduled") r.scheduledAt = until;
    },
  };
  return store;
}

const fu = (id: string, o: Partial<DueFollowUp> = {}): DueFollowUp => ({
  id,
  conversationId: "c1",
  status: "scheduled",
  scheduledAt: ago(0.1),
  createdAt: ago(3),
  messageBody: "checking in",
  templateId: null,
  lastInboundAt: ago(4),
  conversationResolved: false,
  consent: "unknown",
  approvedTemplate: null,
  orderStatus: null,
  ...o,
});

describe("dispatchDue", () => {
  it("queues free text in the window and is idempotent across retried ticks", async () => {
    const s = fakeStore([fu("a")]);
    const first = await dispatchDue(s, { quietHours: null }, "UTC", now);
    expect(first).toEqual([{ followUpId: "a", decision: "send_text", messageId: "msg-a" }]);
    // Retry (e.g. enqueue lost and tick re-runs): nothing is re-dispatched, no second message.
    expect(await dispatchDue(s, { quietHours: null }, "UTC", now)).toEqual([]);
    expect(s.messages.size).toBe(1);
    // Even if the row were still scheduled (crash before markSent committed), the keyed insert dedupes.
    s.rows[0]!.status = "scheduled";
    const again = await dispatchDue(s, { quietHours: null }, "UTC", now);
    expect(again[0]?.messageId).toBe("msg-a");
    expect(s.messages.size).toBe(1);
  });

  it("sends the approved template out of window only with consent, else skips with a reason", async () => {
    const tpl = { id: "t1", body: "Hi there" };
    const s = fakeStore([
      fu("noTpl", { lastInboundAt: ago(30) }),
      fu("noConsent", { lastInboundAt: ago(30), approvedTemplate: tpl }),
      fu("ok", { lastInboundAt: ago(30), approvedTemplate: tpl, consent: "granted" }),
      fu("optOut", { consent: "revoked" }),
    ]);
    const out = await dispatchDue(s, { quietHours: null }, "UTC", now);
    expect(out.find((o) => o.followUpId === "ok")).toMatchObject({ decision: "send_template", messageId: "msg-ok" });
    expect(s.messages.get("ok")?.kind).toBe("template");
    expect(s.reasons.get("noTpl")).toBe("window_closed_no_template");
    expect(s.reasons.get("noConsent")).toBe("window_closed_no_consent");
    expect(s.reasons.get("optOut")).toBe("consent_revoked");
  });

  it("cancels on reply and on paid order without sending", async () => {
    const s = fakeStore([fu("replied", { lastInboundAt: ago(1) }), fu("paid", { orderStatus: "paid" })]);
    await dispatchDue(s, { quietHours: null }, "UTC", now);
    expect(s.rows.map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
    expect(s.reasons.get("replied")).toBe("contact_replied");
    expect(s.messages.size).toBe(0);
  });

  it("defers during quiet hours and keeps the follow-up scheduled", async () => {
    const s = fakeStore([fu("q")]);
    const out = await dispatchDue(s, { quietHours: { start: "11:00", end: "13:00" } }, "UTC", now);
    expect(out[0]?.decision).toBe("defer");
    expect(s.rows[0]?.status).toBe("scheduled");
    expect(s.rows[0]?.scheduledAt.toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
});
