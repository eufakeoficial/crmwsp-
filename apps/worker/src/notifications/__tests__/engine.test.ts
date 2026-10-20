import { describe, expect, it } from "vitest";
import { resolveNotificationSettings } from "@crmwsp/contracts";
import { dispatchNotifications, type NotificationStore, type OwnerConversation, type PendingNotification, type WhatsappOutcome } from "../engine.js";

const NOW = new Date("2026-10-20T12:00:00Z");
const n = (id: string, kind: PendingNotification["kind"] = "order_paid"): PendingNotification => ({ id, kind, title: `t-${id}`, body: null });

function fakeStore(pending: PendingNotification[], owner: OwnerConversation | null) {
  const marked = new Map<string, WhatsappOutcome>();
  const sent: Array<{ id: string; conv: string; body: string }> = [];
  const store: NotificationStore = {
    lockUndispatched: async () => pending,
    ownerConversation: async () => owner,
    insertOwnerMessage: async (x, conv, body) => {
      sent.push({ id: x.id, conv, body });
      return `msg-${x.id}`;
    },
    markDispatched: async (id, outcome) => {
      marked.set(id, outcome);
    },
  };
  return { store, marked, sent };
}

describe("dispatchNotifications", () => {
  it("publishes in-app only when no owner phone is configured", async () => {
    const { store, marked, sent } = fakeStore([n("a")], null);
    const res = await dispatchNotifications(store, resolveNotificationSettings(undefined), NOW);
    expect(res.notificationIds).toEqual([{ id: "a", kind: "order_paid" }]);
    expect(marked.get("a")).toEqual({ status: "not_configured" });
    expect(sent).toEqual([]);
  });

  it("sends to the owner inside the 24 h window", async () => {
    const owner = { conversationId: "conv", lastInboundAt: new Date(NOW.getTime() - 3600_000), channelActive: true };
    const { store, marked, sent } = fakeStore([n("a")], owner);
    const res = await dispatchNotifications(store, resolveNotificationSettings({ ownerPhoneE164: "+5215512345678" }), NOW);
    expect(sent).toEqual([{ id: "a", conv: "conv", body: "t-a" }]);
    expect(res.messageIds).toEqual(["msg-a"]);
    expect(marked.get("a")).toEqual({ status: "sent", messageId: "msg-a" });
  });

  it("skips and records the reason when the window is closed (no template)", async () => {
    const owner = { conversationId: "conv", lastInboundAt: new Date(NOW.getTime() - 25 * 3600_000), channelActive: true };
    const { store, marked, sent } = fakeStore([n("a")], owner);
    const res = await dispatchNotifications(store, resolveNotificationSettings({ ownerPhoneE164: "+5215512345678" }), NOW);
    expect(sent).toEqual([]);
    expect(marked.get("a")).toEqual({ status: "skipped", reason: "window_closed" });
    expect(res.skipped).toEqual([{ id: "a", reason: "window_closed" }]);
    expect(res.notificationIds).toHaveLength(1);
  });

  it("skips when the owner never wrote to the business or the kind is disabled", async () => {
    const settings = resolveNotificationSettings({ ownerPhoneE164: "+5215512345678", whatsappKinds: ["order_paid"] });
    const { store, marked } = fakeStore([n("a"), n("b", "handoff")], null);
    await dispatchNotifications(store, settings, NOW);
    expect(marked.get("a")).toEqual({ status: "skipped", reason: "no_owner_conversation" });
    expect(marked.get("b")).toEqual({ status: "skipped", reason: "kind_disabled" });
  });

  it("falls back to defaults on invalid settings", () => {
    expect(resolveNotificationSettings({ ownerPhoneE164: "12345" }).ownerPhoneE164).toBeNull();
  });
});
