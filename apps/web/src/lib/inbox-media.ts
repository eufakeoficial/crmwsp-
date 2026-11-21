/** Returns a user-facing validation error before an outbound image is uploaded. */
export function validateOutboundImage(file: { type: string; size: number }): string | null {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return "Solo se pueden enviar imágenes JPG o PNG.";
  if (file.size <= 0) return "La imagen está vacía.";
  if (file.size > 5 * 1024 * 1024) return "La imagen pesa más de 5 MB.";
  return null;
}
