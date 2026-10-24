import { describe, expect, it } from "vitest";
import { assessAccountEvent } from "./channel-quality.js";

describe("assessAccountEvent", () => {
  it("phone quality: FLAGGED warns, DOWNGRADE is critical, UNFLAGGED clears", () => {
    expect(assessAccountEvent({ field: "phone_number_quality_update", event: "FLAGGED" })).toEqual({
      severity: "warning",
      quality: "RED",
      accountStatus: "flagged",
    });
    expect(assessAccountEvent({ field: "phone_number_quality_update", event: "downgrade" }).severity).toBe("critical");
    expect(assessAccountEvent({ field: "phone_number_quality_update", event: "UNFLAGGED" })).toEqual({
      severity: "info",
      quality: "GREEN",
      accountStatus: "ok",
    });
  });

  it("account restrictions and bans are critical", () => {
    expect(assessAccountEvent({ field: "account_update", event: "ACCOUNT_RESTRICTION" })).toMatchObject({ severity: "critical", accountStatus: "restricted" });
    expect(assessAccountEvent({ field: "account_update", event: "DISABLED_UPDATE" })).toMatchObject({ severity: "critical", accountStatus: "disabled" });
    expect(assessAccountEvent({ field: "account_update", event: "VERIFIED_ACCOUNT" })).toMatchObject({ severity: "info", accountStatus: null });
  });

  it("template status and quality", () => {
    expect(assessAccountEvent({ field: "message_template_status_update", event: "PAUSED" }).severity).toBe("warning");
    expect(assessAccountEvent({ field: "message_template_status_update", event: "DISABLED" }).severity).toBe("critical");
    expect(assessAccountEvent({ field: "message_template_status_update", event: "APPROVED" }).severity).toBe("info");
    expect(assessAccountEvent({ field: "message_template_quality_update", event: null, quality: "red" }).severity).toBe("warning");
    expect(assessAccountEvent({ field: "message_template_quality_update", event: null, quality: "GREEN" }).severity).toBe("info");
  });

  it("never changes the number's quality from a template event", () => {
    expect(assessAccountEvent({ field: "message_template_quality_update", event: null, quality: "RED" }).quality).toBeNull();
  });
});
