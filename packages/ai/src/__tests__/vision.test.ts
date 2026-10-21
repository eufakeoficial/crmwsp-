import { describe, expect, it } from "vitest";
import { toWireMessage } from "../provider/openai-compatible.js";

describe("toWireMessage", () => {
  it("keeps text-only messages unchanged", () => {
    expect(toWireMessage({ role: "user", content: "hi" })).toEqual({ role: "user", content: "hi" });
  });
  it("sends images as data-URL content parts", () => {
    const wire = toWireMessage({ role: "user", content: "read", images: [{ mimeType: "image/png", data: new Uint8Array([1, 2]) }] });
    expect(wire).toEqual({
      role: "user",
      content: [
        { type: "text", text: "read" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AQI=" } },
      ],
    });
  });
});
