import { INBOX_EVENT_TYPES, inboxEventSchema } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";

describe("SSE event types the web subscribes to", () => {
  it("includes the AI events and message.created", () => {
    expect(INBOX_EVENT_TYPES).toEqual(expect.arrayContaining(["ai.action_pending", "ai.reply_drafted", "ai.handoff", "ai.budget_warning", "message.created"]));
  });
  it("parses an ai.action_pending frame", () => {
    const frame = { type: "ai.action_pending", conversationId: "3f1c2b8e-9a4d-4c1e-8b2a-1d2e3f4a5b6c", actionId: "7d1c2b8e-9a4d-4c1e-8b2a-1d2e3f4a5b6c" };
    expect(inboxEventSchema.safeParse(frame).success).toBe(true);
  });
});
