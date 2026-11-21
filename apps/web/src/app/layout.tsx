import type { Metadata, Viewport } from "next";
import { Sora } from "next/font/google";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { BRAND_COLOR, getSiteUrl, SITE_DESCRIPTION, SITE_LOCALE, SITE_NAME, SITE_TITLE } from "@/lib/site";
import { ConsentBanner } from "@/components/tracking/ConsentBanner";
import { Tracking } from "@/components/tracking/Tracking";
import "./globals.css";

// Self-hosted (SIL OFL 1.1, see src/fonts/OFL.txt) so builds never depend on Google Fonts at build time.
const jakarta = localFont({
  src: "../fonts/PlusJakartaSans-latin-var.woff2",
  weight: "400 800",
  variable: "--font-jakarta",
  display: "swap",
});

// Display font for landing headings only; body keeps Plus Jakarta Sans.
const display = Sora({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-display", display: "swap" });

const DEFAULT_TITLE = `${SITE_TITLE} | ${SITE_NAME}`;

// Canonical URLs are set per page (a root-level canonical would point every route at "/").
export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: { default: DEFAULT_TITLE, template: `%s | ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: {
    type: "website",
    locale: SITE_LOCALE,
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    url: "/",
  },
  twitter: { card: "summary_large_image", title: DEFAULT_TITLE, description: SITE_DESCRIPTION },
  icons: { icon: "/icon.png", apple: "/icon.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: BRAND_COLOR };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es" className={`${jakarta.variable} ${display.variable}`}>
      <body>
        {children}
        <ConsentBanner />
        <Tracking />
      </body>
    </html>
  );
}
