import { renderSVG } from "uqr";

/**
 * Renders `text` as an inline SVG QR code (dark modules on a white background, with a quiet zone).
 * Pure and client-side: the payload (a deposit address) never leaves the browser.
 */
export function qrSvg(text: string): string {
  return renderSVG(text, { ecc: "M", border: 4, whiteColor: "#ffffff", blackColor: "#000000" });
}
