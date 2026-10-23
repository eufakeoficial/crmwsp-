import type { Metadata, Viewport } from "next";
import { Unbounded } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import "./globals.css";

// Self-hosted (SIL OFL 1.1, see src/fonts/OFL.txt) so builds never depend on Google Fonts at build time.
const jakarta = localFont({
  src: "../fonts/PlusJakartaSans-latin-var.woff2",
  weight: "400 800",
  variable: "--font-jakarta",
  display: "swap",
});

// Display font for landing headings only; body keeps Plus Jakarta Sans.
const unbounded = Unbounded({ subsets: ["latin"], variable: "--font-display", display: "swap" });

export const metadata: Metadata = {
  title: "CRMWSP",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${jakarta.variable} ${unbounded.variable}`}>
      <body>{children}</body>
    </html>
  );
}
