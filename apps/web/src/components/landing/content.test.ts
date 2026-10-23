import { describe, expect, it } from "vitest";
import { DEFINITION, FAQ } from "./content";

const words = (s: string) => s.trim().split(/\s+/).length;

describe("landing answer-first copy", () => {
  it("keeps the definition between 40 and 60 words", () => {
    expect(words(DEFINITION)).toBeGreaterThanOrEqual(40);
    expect(words(DEFINITION)).toBeLessThanOrEqual(60);
  });
  it("keeps the new high-intent answers between 40 and 80 words", () => {
    for (const { question, answer } of FAQ.slice(0, 7)) {
      expect(words(answer), question).toBeGreaterThanOrEqual(40);
      expect(words(answer), question).toBeLessThanOrEqual(80);
    }
  });
});
