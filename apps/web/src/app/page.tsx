import type { Metadata } from "next";
import { SiteAssistant } from "@/components/landing/Assistant";
import { BackToTop } from "@/components/landing/BackToTop";
import { DemoVideo } from "@/components/landing/DemoVideo";
import { DEMO_VIDEO_PLAYBOOK } from "@/components/landing/content";
import { Hero } from "@/components/landing/Hero";
import { Integrations } from "@/components/landing/Integrations";
import { LandingJsonLd } from "@/components/landing/JsonLd";
import { LandingStyles } from "@/components/landing/LandingStyles";
import { LandingMotion } from "@/components/landing/motion";
import { Collaboration, Comparison, Differentiators, Faq, Features, FinalCta, HowItWorks, LookingTo, Pricing, ProblemSolution, Proof, Showcase, WhatIs } from "@/components/landing/Sections";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Static on purpose: reading the session cookie here made the page dynamic (Cache-Control: no-store).
// The header resolves the session in the browser (useSiteUser), so logged-in visitors see "Ir a mi panel" after hydration.
export default function HomePage() {
  return (
    <>
      <LandingJsonLd />
      <LandingStyles />
      <SiteHeader hasSession={false} />
      <LandingMotion>
      <main className="overflow-x-clip">
        <Hero />
        <WhatIs />
        <Integrations />
        <DemoVideo />
        <DemoVideo d={DEMO_VIDEO_PLAYBOOK} id="demo-playbook" flip />
        <Features />
        <ProblemSolution />
        <Showcase />
        <Collaboration />
        <Differentiators />
        <Comparison />
        <HowItWorks />
        <LookingTo />
        <Proof />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>
      <BackToTop />
      <SiteAssistant />
      </LandingMotion>
      <SiteFooter />
    </>
  );
}
