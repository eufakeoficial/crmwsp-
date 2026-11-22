import type { Metadata } from "next";
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

// Static: the header resolves the session in the browser.
export default function PricingPage() {
  return (
    <>
      <LandingStyles />
      <SiteHeader hasSession={false} />
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
