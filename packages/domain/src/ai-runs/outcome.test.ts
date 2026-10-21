import { describe, expect, it } from "vitest";
import { classifyAiRun } from "./outcome.js";

describe("classifyAiRun", () => {
  it("maps replies and drafts", () => {
    expect(classifyAiRun("send_reply", null)).toEqual({ outcome: "sent", mode: "auto" });
    expect(classifyAiRun("draft_reply", "low confidence")).toEqual({ outcome: "draft", mode: "draft" });
  });
  it("separates blocked, error and plain handoffs", () => {
    expect(classifyAiRun("handoff", "budget_exceeded")?.outcome).toBe("blocked");
    expect(classifyAiRun("handoff", "plan_limit_reached")?.outcome).toBe("blocked");
    expect(classifyAiRun("handoff", "invalid_output")?.outcome).toBe("error");
    expect(classifyAiRun("handoff", "provider_error_429")?.outcome).toBe("error");
    expect(classifyAiRun("handoff", "customer asked for a human")?.outcome).toBe("handoff");
    expect(classifyAiRun("handoff", null)?.outcome).toBe("handoff");
  });
  it("ignores non-run actions", () => {
    expect(classifyAiRun("update_contact_field", null)).toBeNull();
  });
});
