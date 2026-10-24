import type { Metadata } from "next";
import type { ReactNode } from "react";

// The token lives in the URL: never index it nor leak it through the Referer header.
export const metadata: Metadata = {
  title: "Crear contraseña nueva",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function ResetLayout({ children }: { children: ReactNode }) {
  return children;
}
