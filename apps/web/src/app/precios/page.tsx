import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LandingStyles } from "@/components/landing/LandingStyles";
import { LandingMotion } from "@/components/landing/motion";
import { Faq, FinalCta, Pricing } from "@/components/landing/Sections";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Planes Start (USD 49/mes) y Pro (USD 89/mes) de Vende+ WSP: CRM de WhatsApp con IA, sin recargo sobre los mensajes de WhatsApp. 7 días de prueba gratis.",
  alternates: { canonical: "/precios" },
};

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

export default async function PricingPage() {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <LandingStyles />
      <SiteHeader hasSession={hasSession} />
      <LandingMotion>
        <main className="overflow-x-clip pt-24">
          <Pricing />
          <Faq />
          <FinalCta />
        </main>
      </LandingMotion>
      <SiteFooter />
    </>
  );
}
