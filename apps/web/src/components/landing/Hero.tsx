import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLink, ArrowNudge, CheckRow, CountUp, HeroGlow, HeroTitle, Reveal, Stagger, StaggerItem } from "./motion";
import { ArrowUpRight, MessageCircle } from "lucide-react";
import { AssistantCta } from "./Assistant";
import { DISPLAY, PILL_OUTLINE } from "./styles";

// Below the fold: its own chunk keeps it out of the hydration-critical bundle (still server-rendered).
const SavingsCalculator = dynamic(() => import("./Calculator").then((mod) => mod.SavingsCalculator));

const CHECKS = [
  { text: "Respuestas con IA y fuente citada", highlight: false },
  { text: "Pagos confirmados por el proveedor", highlight: true },
  { text: "Pasa a una persona cuando no sabe", highlight: false },
  { text: "Datos aislados por empresa", highlight: false },
] as const;

const STATS = [
  { to: 24, suffix: "/7", label: "Respuestas con IA" },
  { to: 100, suffix: "%", label: "Pagos verificados por el proveedor" },
  { to: 1, suffix: "", label: "Bandeja para todo el equipo" },
] as const;

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="relative isolate overflow-hidden rounded-b-[clamp(28px,4vw,48px)] bg-[linear-gradient(180deg,#050a3a_0%,#0a1696_55%,#1233d8_100%)] pb-[clamp(32px,5vw,64px)] text-white">
      <HeroGlow />
      <div className="container-page relative pt-[clamp(36px,6vw,80px)]">
        <div className="grid gap-8 desk:grid-cols-[1.6fr_1fr] desk:items-start">
          <div>
            <Reveal as="p" y={12} blur className="m-0 mb-4 text-sm font-semibold tracking-wide text-white/80 uppercase">CRM de WhatsApp con IA para negocios que cotizan</Reveal>
            <HeroTitle id="hero-title" text="Vende más por WhatsApp" className={`${DISPLAY} m-0 text-[clamp(2.125rem,1.2rem+4.6vw,5.75rem)] leading-[1.02] font-bold tracking-[-0.03em] text-balance [overflow-wrap:anywhere]`} />
          </div>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm desk:mt-6">
            {CHECKS.map(({ text, highlight }, i) => (
              <CheckRow key={text} highlight={highlight} index={i}>
                <Check aria-hidden className={`size-4 shrink-0 ${highlight ? "text-ink" : "text-lime"}`} />
                {text}
              </CheckRow>
            ))}
          </ul>
        </div>

        <Reveal delay={0.55} blur className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <ArrowLink magnetic href="/signup" className={`${PILL_OUTLINE} border-white/70 text-white`}>
            Crear cuenta gratis
            <ArrowNudge><ArrowUpRight className="size-5" /></ArrowNudge>
          </ArrowLink>
          <AssistantCta className="inline-flex min-h-12 items-center gap-2 rounded-full px-2 font-semibold text-white underline underline-offset-4 hover:text-lime">
            <MessageCircle aria-hidden className="size-5" />
            Pregúntale al asistente
          </AssistantCta>
          <p className="m-0 max-w-[40ch] text-sm text-white/80">
            Un solo inbox, una IA que cita tu catálogo y cobros confirmados. ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-semibold text-white underline underline-offset-4">Ingresar</Link>
          </p>
        </Reveal>

        <Stagger as="dl" className="m-0 mt-[clamp(32px,5vw,56px)] grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3">
          {STATS.map(({ to, suffix, label }, i) => (
            <StaggerItem as="div" key={label} className={`flex flex-col-reverse ${i === 2 ? "col-span-2 sm:col-span-1" : ""}`}>
              <dt className="text-sm text-white/80">{label}</dt>
              <dd className={`${DISPLAY} m-0 text-[clamp(1.75rem,1.3rem+1.6vw,2.5rem)] font-semibold`}><CountUp to={to} suffix={suffix} /></dd>
            </StaggerItem>
          ))}
        </Stagger>

        <div className="mt-[clamp(32px,5vw,64px)]">
          <SavingsCalculator />
        </div>
      </div>
    </section>
  );
}
