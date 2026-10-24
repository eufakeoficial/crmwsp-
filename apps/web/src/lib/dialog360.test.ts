import { describe, expect, it } from "vitest";
import { buildDialog360ConnectUrl, parseDialog360Callback } from "./dialog360";

describe("buildDialog360ConnectUrl", () => {
  it("encodes the redirect url", () => {
    expect(buildDialog360ConnectUrl("P1", "https://app.example.com/")).toBe(
      "https://hub.360dialog.com/dashboard/app/P1/permissions?redirect_url=https%3A%2F%2Fapp.example.com%2Fapp%2Fchannels%2F360dialog%2Fcallback",
    );
  });
});

describe("parseDialog360Callback", () => {
  it("parses bracketed channel lists and the client id", () => {
    expect(parseDialog360Callback("?client=cl_1&channels=[ch1,ch2]")).toEqual({ clientId: "cl_1", channelIds: ["ch1", "ch2"] });
  });
  it("accepts a single bare id and de-duplicates", () => {
    expect(parseDialog360Callback("channels=ch1,ch1")).toEqual({ channelIds: ["ch1"] });
  });
  it("drops anything that is not a safe id", () => {
    expect(parseDialog360Callback("channels=[../x,ok1,a b]").channelIds).toEqual(["ok1"]);
    expect(parseDialog360Callback("").channelIds).toEqual([]);
  });
});
