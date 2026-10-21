export type VoiceReplyModeValue = "off" | "mirror" | "always";

export interface VoiceReplyInput {
  mode: VoiceReplyModeValue;
  /** Settings are complete (key + voice id). */
  configured: boolean;
  /** Author of the outbound message; only AI-authored replies are voiced. */
  author: string;
  /** Outbound message type; only plain text is voiced (templates never). */
  messageType: string;
  /** Type of the latest inbound customer message in the conversation, if any. */
  lastInboundType: string | null;
}

/**
 * Whether an outbound reply should be sent as a synthesized voice note. Only already-approved AI
 * text replies are voiced: the text is the same one the policy engine let through, never rewritten.
 */
export function shouldSendVoiceReply(i: VoiceReplyInput): boolean {
  if (!i.configured || i.mode === "off") return false;
  if (i.author !== "ai" || i.messageType !== "text") return false;
  if (i.mode === "always") return true;
  return i.lastInboundType === "audio";
}
