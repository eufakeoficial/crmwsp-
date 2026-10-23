import type { Metadata } from "next";
import { cookies } from "next/headers";
import { SiteAssistant } from "@/components/landing/Assistant";
import { Hero } from "@/components/landing/Hero";
import { Integrations } from "@/components/landing/Integrations";
import { LandingJsonLd } from "@/components/landing/JsonLd";
import { LandingStyles } from "@/components/landing/LandingStyles";
import { LandingMotion } from "@/components/landing/motion";
import { DemoVideo, Collaboration, Comparison, Differentiators, Faq, Features, FinalCta, HowItWorks, LookingTo, PricingTeaser, ProblemSolution, Proof, Showcase, WhatIs } from "@/components/landing/Sections";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

export default async function HomePage() {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <LandingJsonLd />
      <LandingStyles />
      <SiteHeader hasSession={hasSession} />
      <LandingMotion>
      <main className="overflow-x-clip">
        <Hero />
        <WhatIs />
        <Integrations />
        <Features />
        <ProblemSolution />
        <Showcase />
        <Collaboration />
        <Differentiators />
        <Comparison />
        <HowItWorks />
        <DemoVideo />
        <LookingTo />
        <Proof />
        <PricingTeaser />
        <Faq />
        <FinalCta />
      </main>
      <SiteAssistant />
      </LandingMotion>
      <SiteFooter />
    </>
  );
}
