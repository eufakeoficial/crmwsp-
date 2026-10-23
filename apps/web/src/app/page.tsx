import { cookies } from "next/headers";
import { Hero } from "@/components/landing/Hero";
import { LandingStyles } from "@/components/landing/LandingStyles";
import { LandingMotion } from "@/components/landing/motion";
import { DemoVideo, Collaboration, Differentiators, Faq, Features, FinalCta, HowItWorks, LookingTo, PricingTeaser, ProblemSolution, Proof, Showcase, TrustStrip } from "@/components/landing/Sections";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

export default async function HomePage() {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <LandingStyles />
      <SiteHeader hasSession={hasSession} />
      <LandingMotion>
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <ProblemSolution />
        <Showcase />
        <Collaboration />
        <Differentiators />
        <HowItWorks />
        <DemoVideo />
        <LookingTo />
        <Proof />
        <PricingTeaser />
        <Faq />
        <FinalCta />
      </main>
      </LandingMotion>
      <SiteFooter />
    </>
  );
}
