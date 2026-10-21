import { botTemplateSchema } from "@crmwsp/contracts";
import { describe, expect, it } from "vitest";
import { BOT_TEMPLATES, composeTemplatePrompt, getBotTemplate } from "./index.js";

describe("bot templates", () => {
  it("ships six valid presets with unique ids", () => {
    expect(BOT_TEMPLATES).toHaveLength(6);
    for (const t of BOT_TEMPLATES) expect(botTemplateSchema.safeParse(t).success).toBe(true);
    expect(new Set(BOT_TEMPLATES.map((t) => t.id)).size).toBe(6);
  });
  it("finds by id", () => {
    expect(getBotTemplate("events")?.industry).toBe("events");
    expect(getBotTemplate("nope")).toBeUndefined();
  });
  it("composes a prompt within the agent prompt limit including quick replies", () => {
    for (const t of BOT_TEMPLATES) {
      const p = composeTemplatePrompt(t);
      expect(p.length).toBeLessThanOrEqual(20_000);
      expect(p).toContain(t.quickReplies[0]);
      expect(p).toContain(t.followUps[0]);
    }
  });
});
