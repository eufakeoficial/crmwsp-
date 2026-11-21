import { describe, expect, it } from "vitest";
import { validateOutboundImage } from "./inbox-media";

describe("validateOutboundImage", () => {
  it("accepts JPEG and PNG through 5 MB", () => {
    expect(validateOutboundImage({ type: "image/jpeg", size: 1 })).toBeNull();
    expect(validateOutboundImage({ type: "image/png", size: 5 * 1024 * 1024 })).toBeNull();
  });

  it("rejects other types, empty files, and oversized images", () => {
    expect(validateOutboundImage({ type: "image/webp", size: 1 })).toBe("Solo se pueden enviar imágenes JPG o PNG.");
    expect(validateOutboundImage({ type: "image/jpeg", size: 0 })).toBe("La imagen está vacía.");
    expect(validateOutboundImage({ type: "image/png", size: 5 * 1024 * 1024 + 1 })).toBe("La imagen pesa más de 5 MB.");
  });
});
