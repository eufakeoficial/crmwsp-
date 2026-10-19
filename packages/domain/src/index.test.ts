import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@crmwsp/domain", () => {
  it("exposes its placeholder export", () => {
    expect(packageName).toBe("@crmwsp/domain");
  });
});
