import { describe, expect, it } from "vitest";
import { availableQuoteActions } from "./quote-meta";

describe("availableQuoteActions", () => {
  it("lets writers edit and submit drafts", () => {
    expect(availableQuoteActions("draft", "agent")).toEqual(["edit", "submit"]);
  });
  it("restricts approval to owner and admin", () => {
    expect(availableQuoteActions("pending_approval", "agent")).toEqual([]);
    expect(availableQuoteActions("pending_approval", "admin")).toEqual(["approve", "reject"]);
  });
  it("offers nothing to viewers", () => {
    expect(availableQuoteActions("approved", "viewer")).toEqual([]);
  });
  it("follows the send -> link -> order path", () => {
    expect(availableQuoteActions("approved", "owner")).toEqual(["send"]);
    expect(availableQuoteActions("sent", "owner")).toEqual(["link"]);
    expect(availableQuoteActions("accepted", "owner")).toEqual(["order"]);
    expect(availableQuoteActions("expired", "owner")).toEqual([]);
  });
});
