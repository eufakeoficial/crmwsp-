import { describe, expect, it } from "vitest";
import { shouldSendVoiceReply, type VoiceReplyInput } from "./index.js";

const base: VoiceReplyInput = { mode: "mirror", configured: true, author: "ai", messageType: "text", lastInboundType: "audio" };

describe("shouldSendVoiceReply", () => {
  it("mirror voices only when the customer sent audio", () => {
    expect(shouldSendVoiceReply(base)).toBe(true);
    expect(shouldSendVoiceReply({ ...base, lastInboundType: "text" })).toBe(false);
    expect(shouldSendVoiceReply({ ...base, lastInboundType: null })).toBe(false);
  });
  it("always voices AI text regardless of inbound type", () => {
    expect(shouldSendVoiceReply({ ...base, mode: "always", lastInboundType: "text" })).toBe(true);
  });
  it("never voices when off, unconfigured, human-authored or non-text", () => {
    expect(shouldSendVoiceReply({ ...base, mode: "off" })).toBe(false);
    expect(shouldSendVoiceReply({ ...base, configured: false })).toBe(false);
    expect(shouldSendVoiceReply({ ...base, author: "user" })).toBe(false);
    expect(shouldSendVoiceReply({ ...base, messageType: "template" })).toBe(false);
  });
});
