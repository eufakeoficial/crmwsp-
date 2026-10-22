import { cookies } from "next/headers";
import { Hero } from "@/components/landing/Hero";
import { LandingStyles } from "@/components/landing/LandingStyles";
import { DemoVideo, Differentiators, Faq, Features, FinalCta, HowItWorks, PricingTeaser, ProblemSolution, Proof, Showcase, TrustStrip } from "@/components/landing/Sections";
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
      <main>
        <Hero />
        <TrustStrip />
        <ProblemSolution />
        <Features />
        <Showcase />
        <Differentiators />
        <HowItWorks />
        <DemoVideo />
        <Proof />
        <PricingTeaser />
        <Faq />
        <FinalCta />
      </main>
      <SiteFooter />
    </>
  );
}
