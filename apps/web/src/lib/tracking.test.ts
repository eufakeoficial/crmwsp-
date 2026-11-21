import { describe, expect, it } from "vitest";
import { parseConsent } from "./consent";
import { metaPixelSnippet, readCookie } from "./tracking";

describe("consent", () => {
  it("only accepts the two explicit values", () => {
    expect(parseConsent("accepted")).toBe("accepted");
    expect(parseConsent("rejected")).toBe("rejected");
    expect(parseConsent("yes")).toBe("unset");
    expect(parseConsent(null)).toBe("unset");
  });
});

describe("tracking helpers", () => {
  it("reads cookies by exact name", () => {
    expect(readCookie("_fbp", "a=1; _fbp=fb.1.2.3; _fbc=x")).toBe("fb.1.2.3");
    expect(readCookie("_fbp", "x_fbp=1")).toBeUndefined();
  });
  it("embeds the pixel id and the official loader", () => {
    const s = metaPixelSnippet("123456789");
    expect(s).toContain("fbq('init','123456789')");
    expect(s).toContain("https://connect.facebook.net/en_US/fbevents.js");
  });
});
