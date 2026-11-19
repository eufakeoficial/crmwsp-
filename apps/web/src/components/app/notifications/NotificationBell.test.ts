import { describe, expect, it } from "vitest";
import { notificationHref } from "./NotificationBell";

describe("notificationHref", () => {
  it("links channel_credentials to the channels page", () => {
    expect(notificationHref({ kind: "channel_credentials", entity: "channel_connection", entityId: null, conversationId: null })).toBe("/app/channels");
  });
});
