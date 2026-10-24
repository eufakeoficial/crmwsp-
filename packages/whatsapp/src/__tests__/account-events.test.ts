import { describe, expect, it } from "vitest";
import { Dialog360Provider } from "../dialog360/provider.js";
import { parseGupshupWebhook } from "../gupshup/parse.js";

const envelope = (field: string, value: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field, value }] }],
});

describe("v3 account/number/template events", () => {
  it("normalizes a phone quality update (whitelisted fields only)", () => {
    const body = envelope("phone_number_quality_update", { display_phone_number: "34 600 111 222", event: "FLAGGED", current_limit: "TIER_1K", secret: "x" });
    const [r] = new Dialog360Provider({ fetch: (() => Promise.reject(new Error("no"))) as typeof fetch }).parseWebhook(body, {});
    expect(r).toMatchObject({
      kind: "account",
      account: { field: "phone_number_quality_update", event: "FLAGGED", messagingLimit: "TIER_1K", phone: "+34600111222" },
    });
    expect(JSON.stringify(r)).not.toContain("secret");
    // Same payload, same dedupe key (BSP retries are idempotent).
    const [again] = parseGupshupWebhook(body);
    expect(again && "dedupeKey" in again ? again.dedupeKey : null).toBe(r && "dedupeKey" in r ? r.dedupeKey : undefined);
  });

  it("reads restriction, violation and template events", () => {
    const [restr] = parseGupshupWebhook(envelope("account_update", { event: "ACCOUNT_RESTRICTION", restriction_info: [{ restriction_type: "RESTRICTED_ADD_PHONE_NUMBER_ACTION" }] }));
    expect(restr).toMatchObject({ kind: "account", account: { event: "ACCOUNT_RESTRICTION", reason: "RESTRICTED_ADD_PHONE_NUMBER_ACTION" } });
    const [tpl] = parseGupshupWebhook(
      envelope("message_template_status_update", { event: "PAUSED", message_template_name: "promo_otono", message_template_language: "es", reason: "LOW_QUALITY" }),
    );
    expect(tpl).toMatchObject({ kind: "account", account: { event: "PAUSED", templateName: "promo_otono", templateLanguage: "es", reason: "LOW_QUALITY" } });
    const [q] = parseGupshupWebhook(envelope("message_template_quality_update", { new_quality_score: "red", message_template_name: "promo_otono" }));
    expect(q).toMatchObject({ kind: "account", account: { quality: "RED" } });
  });

  it("still ignores unknown fields", () => {
    expect(parseGupshupWebhook(envelope("security", { event: "x" }))[0]?.kind).toBe("ignored");
  });
});
