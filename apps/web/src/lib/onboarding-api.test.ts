import { describe, expect, it } from "vitest";
import { type OnboardingStatus, buildChecklist, checklistProgress } from "./onboarding-api";

const base: OnboardingStatus = { hasProducts: false, hasKnowledge: false, hasAiKey: false, hasChannel: false, hasAgentConfig: false, hasTeam: false };

describe("buildChecklist / checklistProgress", () => {
  it("has 5 steps with the team step optional", () => {
    const items = buildChecklist(base, null);
    expect(items).toHaveLength(5);
    expect(items.filter((i) => i.optional).map((i) => i.step)).toEqual(["team"]);
    expect(checklistProgress(items)).toEqual({ done: 0, total: 4, complete: false });
  });
  it("is complete once the 4 required steps are done, without team", () => {
    const items = buildChecklist({ ...base, hasChannel: true, hasKnowledge: true, hasAgentConfig: true }, { current: 0, done: {}, dismissed: false, manual: { simulator: true } });
    expect(checklistProgress(items)).toEqual({ done: 4, total: 4, complete: true });
  });
  it("needs the manual simulator flag", () => {
    const items = buildChecklist({ ...base, hasChannel: true, hasProducts: true, hasAgentConfig: true }, null);
    expect(checklistProgress(items).complete).toBe(false);
  });
});
