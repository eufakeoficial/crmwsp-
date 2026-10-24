import { describe, expect, it } from "vitest";
import { trialBannerText } from "./trial-banner";

const base = { paidUntil: null, graceDays: 3, setupEndsAt: null, trialEndsAt: null, daysLeft: null };

describe("trialBannerText", () => {
  it("counts the days left in setup and trial", () => {
    expect(trialBannerText({ ...base, access: "setup", daysLeft: 5 })).toBe("Conecta tu WhatsApp para empezar tu prueba: te quedan 5 días para conectar.");
    expect(trialBannerText({ ...base, access: "trial", daysLeft: 1 })).toBe("Prueba gratuita: te quedan 1 día de prueba.");
  });
  it("shows nothing for active or grandfathered tenants", () => {
    expect(trialBannerText({ ...base, access: "active" })).toBeNull();
    expect(trialBannerText({ ...base, access: "unbilled" })).toBeNull();
  });
});
