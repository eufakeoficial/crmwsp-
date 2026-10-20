import type { Message } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { deliveryErrorText, failMessage, mergeMessages, optimisticMessage, removeMessage } from "./inbox-state";

const C = "00000000-0000-4000-8000-0000000000c1";
const base = (over: Partial<Message>): Message => ({
  id: "00000000-0000-4000-8000-000000000001", conversationId: C, direction: "inbound", type: "text", body: "x", status: "received",
  author: "contact", authorUserId: null, clientMessageId: null, error: null, reaction: null, reactionBy: null, sentAt: null, createdAt: "2026-10-19T10:00:00.000Z", attachments: [], ...over,
});

describe("mergeMessages", () => {
  it("sorts oldest first and dedupes by id", () => {
    const a = base({ id: "00000000-0000-4000-8000-00000000000a", createdAt: "2026-10-19T10:00:00.000Z" });
    const b = base({ id: "00000000-0000-4000-8000-00000000000b", createdAt: "2026-10-19T10:01:00.000Z" });
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual([a.id, b.id]);
  });

  it("replaces the optimistic copy with the server message (same clientMessageId)", () => {
    const cid = "00000000-0000-4000-8000-0000000000d1";
    const opt = optimisticMessage(C, "hola", cid, "u1", new Date("2026-10-19T10:02:00.000Z"));
    const server = base({ id: "00000000-0000-4000-8000-0000000000e1", direction: "outbound", status: "sent", clientMessageId: cid, createdAt: "2026-10-19T10:02:01.000Z" });
    const merged = mergeMessages([opt], [server]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.status).toBe("sent");
  });

  it("never duplicates nor regresses status whatever arrives first: 202 or the SSE refresh", () => {
    const cid = "00000000-0000-4000-8000-0000000000d4";
    const opt = optimisticMessage(C, "hola", cid, "u1");
    const accepted = base({ id: "00000000-0000-4000-8000-0000000000e4", direction: "outbound", status: "queued", clientMessageId: cid });
    const failed = { ...accepted, status: "failed" as const, error: { message: "x" } };
    const a = mergeMessages(mergeMessages([opt], [accepted]), [failed]);
    const b = mergeMessages(mergeMessages([opt], [failed]), [accepted]);
    for (const list of [a, b]) {
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: accepted.id, status: "failed" });
    }
    // A late optimistic copy never replaces the server one.
    expect(mergeMessages(b, [opt])[0]?.id).toBe(accepted.id);
  });

  it("keeps in-flight optimistic messages that the server has not returned yet", () => {
    const opt = optimisticMessage(C, "hola", "00000000-0000-4000-8000-0000000000d2", "u1");
    expect(mergeMessages([opt], [base({})])).toHaveLength(2);
  });
});

describe("optimistic helpers", () => {
  const cid = "00000000-0000-4000-8000-0000000000d3";
  it("marks failure and removes", () => {
    const list = [optimisticMessage(C, "hola", cid, "u1")];
    expect(failMessage(list, cid, "boom")[0]).toMatchObject({ status: "failed", error: { message: "boom" } });
    expect(removeMessage(list, cid)).toEqual([]);
  });
  it("formats delivery errors", () => {
    expect(deliveryErrorText({ code: "401", message: "Invalid key" })).toBe("Invalid key (401)");
    expect(deliveryErrorText(null)).toBe("WhatsApp no aceptó el mensaje");
  });
});
