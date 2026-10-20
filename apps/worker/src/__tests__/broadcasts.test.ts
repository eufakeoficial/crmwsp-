import type { WhatsAppConnection, WhatsAppProvider } from "@crmwsp/whatsapp";
import { describe, expect, it, vi } from "vitest";
import { renderTemplateBody, runBroadcastPass, type BroadcastStore, type PendingRecipient, type SendingBroadcast } from "../broadcasts/engine.js";
import { dispatchOutbound } from "../outbound.js";

interface Row extends PendingRecipient {
  broadcastId: string;
  status: "pending" | "skipped" | "sent";
  messageId: string | null;
}

function fakeStore(broadcasts: Array<SendingBroadcast & { status: string; scheduledAt?: Date }>, rows: Row[]) {
  const created: Array<{ recipient: string; body: string }> = [];
  const store: BroadcastStore = {
    async promoteDue(now) {
      let n = 0;
      for (const b of broadcasts) {
        if (b.status === "scheduled" && b.scheduledAt && b.scheduledAt <= now) {
          b.status = "sending";
          n++;
        }
      }
      return n;
    },
    async listSending() {
      return broadcasts.filter((b) => b.status === "sending");
    },
    async lockPending(id, limit) {
      return rows.filter((r) => r.broadcastId === id && r.status === "pending" && !r.messageId).slice(0, limit);
    },
    async createMessage(_b, r, body) {
      const row = rows.find((x) => x.id === r.id)!;
      if (row.messageId) return row.messageId;
      row.messageId = `msg-${r.id}`;
      created.push({ recipient: r.id, body });
      return row.messageId;
    },
    async markSkipped(id) {
      const row = rows.find((x) => x.id === id)!;
      if (row.status === "pending") row.status = "skipped";
    },
    async countPending(id) {
      return rows.filter((r) => r.broadcastId === id && r.status === "pending").length;
    },
    async markCompleted(id) {
      const b = broadcasts.find((x) => x.id === id)!;
      if (b.status === "sending") b.status = "completed";
    },
  };
  return { store, created };
}

const recipient = (id: string, over: Partial<Row> = {}): Row => ({
  id,
  broadcastId: "b1",
  contactId: `c${id}`,
  params: [`N${id}`],
  marketingConsent: "granted",
  status: "pending",
  messageId: null,
  ...over,
});

const now = new Date("2026-10-20T12:00:00Z");

describe("runBroadcastPass", () => {
  it("promotes due campaigns and materialises at most batchSize recipients per pass", async () => {
    const bc = [{ id: "b1", channelConnectionId: "ch", templateBody: "Hola {{1}}", status: "scheduled", scheduledAt: new Date(now.getTime() - 1) }];
    const rows = ["1", "2", "3"].map((i) => recipient(i));
    const { store, created } = fakeStore(bc, rows);
    const r = await runBroadcastPass(store, now, 2);
    expect(r.promoted).toBe(1);
    expect(r.messageIds).toEqual(["msg-1", "msg-2"]);
    expect(created[0]?.body).toBe("Hola N1");
    expect(bc[0]?.status).toBe("sending");
  });

  it("does not resend a recipient that already has a message (idempotent)", async () => {
    const bc = [{ id: "b1", channelConnectionId: "ch", templateBody: "x", status: "sending" }];
    const rows = [recipient("1", { messageId: "msg-old" }), recipient("2")];
    const { store } = fakeStore(bc, rows);
    const first = await runBroadcastPass(store, now, 10);
    const second = await runBroadcastPass(store, now, 10);
    expect(first.messageIds).toEqual(["msg-2"]);
    expect(second.messageIds).toEqual([]);
  });

  it("skips recipients whose marketing consent was revoked after scheduling", async () => {
    const bc = [{ id: "b1", channelConnectionId: "ch", templateBody: "x", status: "sending" }];
    const rows = [recipient("1", { marketingConsent: "revoked" }), recipient("2", { marketingConsent: null })];
    const { store } = fakeStore(bc, rows);
    const r = await runBroadcastPass(store, now, 10);
    expect(r.messageIds).toEqual([]);
    expect(r.skipped).toBe(2);
    expect(r.completed).toBe(1);
  });

  it("completes only when no recipient is pending and ignores cancelled campaigns", async () => {
    const bc = [
      { id: "b1", channelConnectionId: "ch", templateBody: "x", status: "sending" },
      { id: "b2", channelConnectionId: "ch", templateBody: "x", status: "cancelled" },
    ];
    const rows = [recipient("1"), recipient("2", { broadcastId: "b2" })];
    const { store } = fakeStore(bc, rows);
    const r = await runBroadcastPass(store, now, 10);
    expect(r.messageIds).toEqual(["msg-1"]);
    expect(r.completed).toBe(0); // msg-1 is queued: recipient still pending until the send result
    rows[0]!.status = "sent";
    expect((await runBroadcastPass(store, now, 10)).completed).toBe(1);
  });
});

describe("broadcast template dispatch", () => {
  it("renders placeholders", () => {
    expect(renderTemplateBody("Hola {{1}}, {{2}} {{3}}", ["Ana", "PROMO"])).toBe("Hola Ana, PROMO {{3}}");
  });

  it("uses the recipient's pre-resolved params", async () => {
    const sendTemplate = vi.fn(async () => ({ externalId: "tpl-1" }));
    const provider = { sendText: vi.fn(), sendTemplate, sendMedia: vi.fn(), downloadMedia: vi.fn() } as unknown as WhatsAppProvider;
    const conn: WhatsAppConnection = { apiKey: "k", appName: "a", sourcePhone: "+1" };
    await dispatchOutbound(provider, conn, "+2", {
      type: "template",
      body: "Hola {{1}} {{2}}",
      contactName: null,
      params: ["Ana", "PROMO10"],
      template: { externalId: "gs-1", name: "promo", language: "es", status: "approved", variables: [] },
    });
    expect(sendTemplate).toHaveBeenCalledWith(conn, "+2", "gs-1", ["Ana", "PROMO10"]);
  });
});
