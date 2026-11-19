import { describe, expect, it } from "vitest";
import { qrSvg } from "./qr-svg";

const ADDRESS = "0x1111111111111111111111111111111111111111";

describe("qrSvg", () => {
  it("returns a non-empty SVG", () => {
    const svg = qrSvg(ADDRESS);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("</svg>");
  });
  it("is deterministic for the same input", () => {
    expect(qrSvg(ADDRESS)).toBe(qrSvg(ADDRESS));
  });
  it("differs for different input", () => {
    expect(qrSvg(ADDRESS)).not.toBe(qrSvg("0x2222222222222222222222222222222222222222"));
  });
});
