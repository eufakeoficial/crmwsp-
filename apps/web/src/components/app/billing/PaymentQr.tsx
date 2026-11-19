import { useMemo } from "react";
import { qrSvg } from "../../../lib/qr-svg";

/** Scannable QR for a crypto deposit address. Renders nothing when there is no payload. */
export function PaymentQr({ value, size = 192 }: { value: string | null | undefined; size?: number }) {
  const svg = useMemo(() => (value ? qrSvg(value) : null), [value]);
  if (!svg) return null;
  return (
    <div
      role="img"
      aria-label="Código QR para pagar con USDT"
      data-testid="payment-qr"
      className="shrink-0 self-center rounded bg-white [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
      style={{ width: size, height: size }}
      // The SVG is generated locally from a fixed encoder, never from user markup.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
