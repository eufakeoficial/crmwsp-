import { AssistantCta } from "./Assistant";
import {
  ArrowRight, ArrowUpRight, Bot, BookOpenCheck, Check, HandHelping, Inbox, MessageSquareQuote, ReceiptText, ShieldCheck, UsersRound, WalletCards,
} from "lucide-react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { buttonClasses } from "@/components/ui";
import { LOGOS, MEDIA, PRICING_TEASER, TESTIMONIALS, type MediaSpec } from "./media";
import { COMPARISON_COLUMNS, COMPARISON_ROWS, DEFINITION, FAQ, INTEGRATIONS, STEPS } from "./content";
import { MediaSlot } from "./MediaSlot";
import { ArrowLink, ArrowNudge, Float, Marquee, QuoteSteps, Reveal, Spin, Stagger, StaggerItem, StepNumber, StepsProgress, Tilt } from "./motion";
import { DISPLAY, H2, PILL_OUTLINE, SECTION } from "./styles";

export { FAQ };

// Interactive accordion in its own chunk (server-rendered, hydrated lazily).
const Accordion = dynamic(() => import("@/components/ui/Accordion").then((mod) => mod.Accordion));

const SQUARE_BTN = "grid size-16 shrink-0 place-items-center rounded-2xl border-2 border-lime text-lime no-underline transition hover:bg-lime hover:text-ink";

/** Big two-line heading with a small grey side text, as in the reference. */
function Heading({ id, title, lead, dark = false }: { id: string; title: string; lead?: string; dark?: boolean }) {
  return (
    <Reveal as="header" from="left" blur className="mb-8 flex flex-col gap-3 desk:flex-row desk:items-end desk:justify-between desk:gap-12">
      <h2 id={id} className={`${H2} max-w-[22ch]`}>{title}</h2>
      {lead ? <p className={`m-0 max-w-[34ch] ${dark ? "text-white/85" : "text-ink-3"}`}>{lead}</p> : null}
    </Reveal>
  );
}

/** Integration wordmarks as plain text (no logos): factual, nothing to fabricate. */
export function TrustStrip() {
  return (
    <section aria-label="Integraciones" className="container-page py-[clamp(32px,5vw,56px)]">
      <p className="m-0 mb-4 text-center text-sm font-semibold tracking-wide text-ink-3 uppercase">Se integra con</p>
      <Marquee items={INTEGRATIONS} itemClassName={`${DISPLAY} text-[clamp(16px,2vw,22px)] font-bold tracking-[-0.02em] text-ink`} />
    </section>
  );
}

/** Answer-first definition block: one entity-clear paragraph that AI engines can quote verbatim. */
export function WhatIs() {
  return (
    <section id="que-es" aria-labelledby="que-es-title" className="container-page py-[clamp(32px,5vw,64px)]">
      <Reveal from="left" blur className="max-w-[72ch]">
        <h2 id="que-es-title" className={H2}>¿Qué es Vende+ WSP?</h2>
        <p id="que-es-definicion" className="mt-5 mb-0 text-[clamp(1.0625rem,1rem+0.4vw,1.25rem)] leading-relaxed text-ink">{DEFINITION}</p>
      </Reveal>
    </section>
  );
}

/** Capability-based comparison by product category: no competitor brands, no unverifiable claims. */
export function Comparison() {
  const last = COMPARISON_ROWS.length - 1;
  return (
    <section id="comparativa" aria-labelledby="comparativa-title" className="container-page scroll-mt-24 pb-[clamp(56px,8vw,112px)]">
      <div className="relative isolate overflow-hidden rounded-[clamp(28px,4vw,48px)] bg-[linear-gradient(160deg,#050a3a_0%,#0a1696_55%,#1233d8_100%)] px-[clamp(16px,4vw,48px)] py-[clamp(40px,6vw,80px)] text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="absolute -top-24 -left-24 size-80 rounded-full bg-azure opacity-60 blur-3xl" />
          <div className="absolute -right-20 -bottom-24 size-96 rounded-full bg-lime/20 blur-3xl" />
        </div>
        <Heading dark id="comparativa-title" title="Vende+ WSP vs. WhatsApp Business y un CRM genérico." lead="Una comparación por capacidades. Las funciones exactas de cada herramienta varían." />
        <Reveal>
          <div role="region" aria-label="Tabla comparativa, desplázala horizontalmente en pantallas pequeñas" tabIndex={0} className="overflow-x-auto overscroll-x-contain rounded-[24px] border border-white/15 bg-white/[0.06] py-3 backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-lime">
            <table className="w-full min-w-[720px] border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">Comparación de capacidades entre la app WhatsApp Business, un CRM genérico y Vende+ WSP</caption>
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-[#0a1696] p-4 font-semibold text-white/85">Capacidad</th>
                  {COMPARISON_COLUMNS.map((col, i) => (
                    <th key={col} scope="col" className={`${DISPLAY} p-4 font-semibold ${i === 2 ? "rounded-t-2xl border-x-2 border-t-2 border-lime bg-lime text-ink shadow-[0_0_40px_-8px_rgba(210,243,76,0.7)]" : "text-white/85"}`}>{col}</th>
                  ))}
                </tr>
              </thead>
              <Stagger as="tbody">
                {COMPARISON_ROWS.map(({ capability, cells }, r) => (
                  <StaggerItem as="tr" key={capability} className="align-top">
                    <th scope="row" className="sticky left-0 z-10 border-t border-white/15 bg-[#0a1696] p-4 font-semibold text-white">{capability}</th>
                    {cells.map((cell, i) => (
                      <td key={cell} className={i === 2
                        ? `border-x-2 border-t border-lime border-t-lime/30 bg-lime/15 p-4 font-semibold text-white ${r === last ? "rounded-b-2xl border-b-2" : ""}`
                        : "border-t border-white/15 bg-white/[0.04] p-4 text-white/80"}>
                        {i === 2 ? (
                          <span className="flex items-start gap-2">
                            <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-lime text-ink"><Check className="size-3.5" /></span>
                            <span>{cell}</span>
                          </span>
                        ) : cell}
                      </td>
                    ))}
                  </StaggerItem>
                ))}
              </Stagger>
            </table>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

const PAINS = [
  { pain: "Mensajes perdidos entre chats personales y celulares del equipo", solution: "Un inbox compartido con historial por cliente y asignación." },
  { pain: "Cotizar a mano y perseguir el pago después", solution: "Presupuestos y pedidos desde la conversación, con el cobro verificado." },
  { pain: "Un bot que inventa precios y compromete a tu negocio", solution: "IA que cita tu catálogo o deriva a una persona." },
  { pain: "Cada vendedor responde a su manera", solution: "Un playbook de ventas que fija el tono y las reglas del negocio." },
] as const;

export function ProblemSolution() {
  return (
    <section id="problemas" aria-labelledby="problemas-title" className={`${SECTION} pt-[clamp(24px,4vw,48px)]`}>
      <Heading id="problemas-title" title="Del caos del chat al pedido cerrado." lead="Vender por WhatsApp funciona hasta que el equipo crece. Entonces se pierden mensajes, precios y cobros." />
      <Stagger className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {PAINS.map(({ pain, solution }) => (
          <StaggerItem key={pain} className="flex flex-col gap-3 rounded-[28px] border border-line bg-white p-5 sm:p-6">
            <p className="m-0 text-ink-3 line-through decoration-1">{pain}</p>
            <p className="m-0 flex items-start gap-2 font-semibold"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />{solution}</p>
          </StaggerItem>
        ))}
      </Stagger>
    </section>
  );
}

const FEATURES = [
  { icon: Inbox, title: "Inbox de WhatsApp", text: "Todos los números y chats en una bandeja compartida." },
  { icon: Bot, title: "IA con tu catálogo", text: "Responde con tus productos y precios y cita la fuente." },
  { icon: HandHelping, title: "Deriva a una persona", text: "Si no encuentra el dato, pasa la conversación a tu equipo." },
  { icon: MessageSquareQuote, title: "Playbook de ventas", text: "Define tono, reglas y objeciones una vez." },
  { icon: ReceiptText, title: "Presupuestos y pedidos", text: "Crea y envía el presupuesto desde la conversación." },
  { icon: UsersRound, title: "Equipo, roles y medición", text: "Cada persona ve lo suyo; revisa qué hizo la IA y cómo avanzan tus ventas." },
] as const;

export function Features() {
  return (
    <section id="beneficios" aria-labelledby="beneficios-title" className={SECTION}>
      <Heading id="beneficios-title" title="Todo para vender por WhatsApp, en un lugar." lead="Tu equipo, la IA y los cobros trabajan sobre la misma conversación." />
      <div className="grid gap-4 desk:grid-cols-[1.5fr_1fr]">
        <Stagger className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3">
          <StaggerItem pop className="col-span-2 flex flex-col gap-2 rounded-[28px] bg-lime p-5 text-ink sm:col-span-1">
            <WalletCards aria-hidden className="size-8" />
            <h3 className={`${DISPLAY} m-0 text-base font-semibold`}>Pagos verificados</h3>
            <p className="m-0 text-sm">Pagado solo por confirmación del proveedor, nunca por una captura.</p>
          </StaggerItem>
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <StaggerItem key={title} lift className="flex min-w-0 flex-col gap-2 rounded-[28px] border border-line bg-white p-4 sm:p-5">
              <Icon aria-hidden className="size-6 text-ink" />
              <h3 className={`${DISPLAY} m-0 text-base font-semibold`}>{title}</h3>
              <p className="m-0 text-sm text-ink-3 [overflow-wrap:anywhere]">{text}</p>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal spring y={32} className="relative flex min-h-[220px] flex-col justify-between gap-8 rounded-[28px] bg-ink p-[clamp(24px,3vw,36px)] text-white sm:min-h-[260px]">
          <h3 className={`${DISPLAY} m-0 max-w-[12ch] text-[clamp(26px,3vw,38px)] leading-[1.1] font-bold`}>Mira cómo funciona.</h3>
          <ArrowLink href="#como-funciona" aria-label="Ir a Cómo funciona" className={`${SQUARE_BTN} self-end`}>
            <ArrowNudge><ArrowUpRight className="size-8" /></ArrowNudge>
          </ArrowLink>
        </Reveal>
      </div>
    </section>
  );
}

interface ShowcaseItem {
  media: MediaSpec;
  eyebrow: string;
  title: string;
  text: string;
  bullets: readonly string[];
}

const SHOWCASE: readonly ShowcaseItem[] = [
  {
    media: MEDIA.showcaseAi,
    eyebrow: "IA con fuentes",
    title: "Responde con tu catálogo y muestra de dónde sale cada dato",
    text: "La IA solo afirma precios, stock o plazos cuando puede citar tu catálogo. Si no encuentra el dato, deriva la conversación a una persona de tu equipo.",
    bullets: ["Cita visible en cada respuesta", "Derivación a una persona cuando no sabe", "Tu propia clave de IA (BYOK) o créditos incluidos"],
  },
  {
    media: MEDIA.showcasePlaybook,
    eyebrow: "Playbook de ventas",
    title: "Tu proceso comercial, igual para todo el equipo",
    text: "Define las etapas, el tono y las respuestas a las objeciones una sola vez. La IA y tus vendedores responden con el mismo criterio.",
    bullets: ["Etapas y objeciones comunes", "Respuestas sugeridas editables", "Medición del avance por etapa"],
  },
  {
    media: MEDIA.showcaseQuotes,
    eyebrow: "Presupuesto a cobro",
    title: "Del presupuesto aceptado al pago verificado",
    text: "Crea y envía el presupuesto desde la conversación. El pago se marca como pagado solo por confirmación del proveedor, nunca por una captura.",
    bullets: ["Estados claros: enviado, aceptado, pagado", "Pago confirmado por webhook o conciliación", "Historial de actividad por presupuesto"],
  },
];

/** Alternating image/text feature rows. */
export function Showcase() {
  return (
    <section aria-labelledby="destacadas-title" className={`${SECTION} flex flex-col gap-[clamp(40px,6vw,88px)]`}>
      <h2 id="destacadas-title" className="sr-only">Funciones destacadas de Vende+ WSP</h2>
      {SHOWCASE.map(({ media, eyebrow, title, text, bullets }, i) => (
        <Reveal key={title} from={i % 2 === 1 ? "right" : "left"} className="grid items-center gap-8 desk:grid-cols-2 desk:gap-14">
          <Tilt className={i % 2 === 1 ? "desk:order-2" : undefined}>
            <MediaSlot {...media} className="rounded-[28px] shadow-[0_24px_60px_-30px_rgba(18,18,18,0.45)]" sizes="(min-width: 1100px) 560px, 100vw" />
          </Tilt>
          <div>
            <p className="m-0 mb-3 inline-block rounded-full bg-lime px-3 py-1 text-sm font-bold">{eyebrow}</p>
            <h3 className={`${DISPLAY} m-0 text-[clamp(22px,2.6vw,32px)] leading-[1.12] font-bold tracking-[-0.02em]`}>{title}</h3>
            <p className="mt-4 mb-0 text-lg text-ink-3">{text}</p>
            <ul className="mt-5 mb-0 flex list-none flex-col gap-2 p-0">
              {bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 font-semibold">
                  <span aria-hidden className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-lime text-ink"><Check className="size-3.5" /></span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      ))}
    </section>
  );
}

const CIRCLES = [
  { media: MEDIA.hero, pos: "" },
  { media: MEDIA.showcaseAi, pos: "" },
  { media: MEDIA.showcasePlaybook, pos: "" },
  { media: MEDIA.showcaseQuotes, pos: "" },
] as const;

/** Four grayscale circular crops of real product screenshots around a lime four-point star. */
export function Collaboration() {
  return (
    <section aria-labelledby="flujo-title" className={SECTION}>
      <div className="grid items-center gap-10 desk:grid-cols-2 desk:gap-16">
        <div className="relative mx-auto w-full max-w-[420px]">
          <div aria-hidden className="absolute top-1/2 left-1/2 z-0 size-[78%] -translate-x-1/2 -translate-y-1/2 text-lime">
            <Spin className="size-full">
              <svg viewBox="0 0 24 24" className="size-full">
                <path fill="currentColor" d="M12 0C12 7 17 12 24 12C17 12 12 17 12 24C12 17 7 12 0 12C7 12 12 7 12 0Z" />
              </svg>
            </Spin>
          </div>
          <Stagger className="relative z-10 m-0 grid list-none grid-cols-2 gap-[clamp(8px,2.5vw,12px)] p-0">
            {CIRCLES.map(({ media }, i) => (
              <StaggerItem pop key={media.alt}>
                <Float delay={i * 0.6} amount={6 + (i % 2) * 3} className="overflow-hidden rounded-full border-4 border-white bg-paper-2">
                  <MediaSlot {...media} alt="" label={media.label} width={1} height={1} className="rounded-full border-0 grayscale" sizes="210px" />
                </Float>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
        <div>
          <h2 id="flujo-title" className={`${H2} max-w-[16ch]`}>Del primer mensaje al cobro, en un solo flujo.</h2>
          <p className="mt-5 mb-0 flex flex-wrap items-center gap-3">
            <span className={`${DISPLAY} rounded-2xl bg-lime px-3 py-2 text-xl font-bold`}>24/7</span>
            <span className="text-lg font-medium">IA lista para responder.</span>
          </p>
          <p className="mt-5 mb-0 max-w-[44ch] text-ink-3">Conecta tu número, carga tu catálogo y deja que la IA conteste con fuentes mientras tu equipo cierra las ventas.</p>
          <ArrowLink magnetic href="/signup" className={`${PILL_OUTLINE} mt-7 w-full justify-between text-ink hover:bg-ink/5 sm:w-auto sm:min-w-[300px]`}>
            Crear cuenta gratis
            <ArrowNudge><ArrowUpRight className="size-5" /></ArrowNudge>
          </ArrowLink>
        </div>
      </div>
    </section>
  );
}

const DIFFERENTIATORS = [
  { icon: BookOpenCheck, title: "La IA solo responde con fuentes", text: "Toda afirmación de precio, stock o plazo lleva cita a tu catálogo. Sin cita, la conversación pasa a una persona." },
  { icon: WalletCards, title: "Pagos verificados, no supuestos", text: "Un pago es pagado por confirmación del proveedor o conciliación. Una foto de comprobante nunca basta." },
  { icon: ShieldCheck, title: "WhatsApp oficial, sin atajos", text: "Conectas tu número mediante un proveedor oficial de la API de WhatsApp Business. Nada de librerías no oficiales." },
] as const;

export function Differentiators() {
  return (
    <section id="diferenciales" aria-labelledby="diferenciales-title" className={SECTION}>
      <div className="rounded-[32px] bg-ink px-[clamp(16px,5vw,64px)] py-[clamp(32px,6vw,72px)] text-white">
        <header className="mb-8 max-w-[60ch]">
          <p className="m-0 mb-2 text-sm font-bold tracking-wide text-lime uppercase">Por qué confiar</p>
          <h2 id="diferenciales-title" className={H2}>Automatiza sin arriesgar la palabra de tu negocio<span className="text-lime">.</span></h2>
        </header>
        <Stagger className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {DIFFERENTIATORS.map(({ icon: Icon, title, text }) => (
            <StaggerItem key={title} lift className="flex flex-col gap-3 rounded-[24px] border border-ink-4 bg-ink-2 p-5 sm:p-6">
              <span className="grid size-12 place-items-center rounded-2xl bg-lime text-ink"><Icon aria-hidden className="size-6" /></span>
              <h3 className={`${DISPLAY} m-0 text-[17px] font-semibold`}>{title}</h3>
              <p className="m-0 text-subtle">{text}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section id="como-funciona" aria-labelledby="como-title" className="container-page scroll-mt-24 pb-[clamp(56px,8vw,112px)]">
      <div className="relative isolate overflow-hidden rounded-[clamp(28px,4vw,48px)] bg-[linear-gradient(160deg,#050a3a_0%,#0a1696_55%,#1233d8_100%)] px-[clamp(16px,4vw,48px)] py-[clamp(40px,6vw,80px)] text-white">
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(255,255,255,0.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.6)_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
          <div className="absolute -top-24 -left-24 size-80 rounded-full bg-azure opacity-60 blur-3xl" />
          <div className="absolute -right-20 -bottom-24 size-96 rounded-full bg-lime/20 blur-3xl" />
        </div>
        <Heading dark id="como-title" title="Listo para atender en cuatro pasos." />
        <StepsProgress>
          <Stagger as="ol" className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 desk:grid-cols-4">
            {STEPS.map(({ title, text }, index) => (
              <StaggerItem key={title} lift className="flex flex-col gap-3 rounded-[28px] border border-white/20 bg-white/10 p-6 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.5)] backdrop-blur-md transition-colors hover:border-lime/60 hover:bg-white/[0.16]">
                <StepNumber index={index} total={STEPS.length} className={DISPLAY} />
                <h3 className={`${DISPLAY} m-0 text-lg font-semibold text-white`}><span className="sr-only">Paso {index + 1}: </span>{title}</h3>
                <p className="m-0 text-white/85">{text}</p>
              </StaggerItem>
            ))}
          </Stagger>
        </StepsProgress>
      </div>
    </section>
  );
}

export function DemoVideo() {
  return (
    <section id="demo" aria-labelledby="demo-title" className={SECTION}>
      <Heading id="demo-title" title="Míralo en acción." lead="De un mensaje de WhatsApp a un presupuesto cobrado, todo conectado en un solo flujo." />
      <Reveal spring from="scale" blur><MediaSlot {...MEDIA.demoVideo} className="mx-auto max-w-[1000px] rounded-[32px] border-ink-4 shadow-[0_0_80px_-24px_rgba(18,51,216,0.5)]" sizes="(min-width: 1100px) 1000px, 100vw" /></Reveal>
    </section>
  );
}

const NEEDS = ["Responder más rápido", "Cotizar desde el chat", "Cobrar con pago verificado", "Ordenar al equipo", "Controlar lo que dice la IA"] as const;
const QUOTE_STEPS = [
  { label: "Enviado", active: false },
  { label: "Aceptado", active: true },
  { label: "Pagado", active: false },
] as const;

/** Outlined chips next to a lime-ringed grayscale circle with a black "Presupuesto aceptado" card. */
export function LookingTo() {
  return (
    <section aria-labelledby="necesitas-title" className={SECTION}>
      <div className="grid items-center gap-10 desk:grid-cols-2 desk:gap-16">
        <div>
          <h2 id="necesitas-title" className={`${H2} max-w-[14ch]`}>¿Qué quieres resolver?</h2>
          <p className="mt-4 mb-0 max-w-[40ch] text-ink-3">Conecta tu WhatsApp y ordena la conversación, el presupuesto y el cobro en un mismo lugar.</p>
          <Stagger className="m-0 mt-6 flex list-none flex-wrap gap-2 p-0">
            {NEEDS.map((n) => (
              <StaggerItem pop key={n} className="rounded-full border border-ink px-4 py-2.5 text-base font-medium sm:px-5 sm:text-[17px]">{n}</StaggerItem>
            ))}
          </Stagger>
        </div>
        <div className="relative mx-auto w-full max-w-[420px] pb-10">
          <Reveal spring y={24} className="rounded-full bg-lime p-[clamp(8px,2.5vw,12px)]">
            <div className="overflow-hidden rounded-full border-4 border-white">
              <MediaSlot {...MEDIA.showcaseQuotes} width={1} height={1} className="rounded-full border-0 grayscale" sizes="420px" />
            </div>
          </Reveal>
          <Reveal spring y={28} delay={0.3} className="absolute right-0 bottom-0 w-[min(220px,68%)] rounded-2xl bg-ink p-3 text-white shadow-xl sm:p-4">
            <p className="m-0 mb-3 text-xs font-bold tracking-[0.2em] uppercase">Presupuesto aceptado</p>
            <QuoteSteps steps={QUOTE_STEPS} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/** Real customer logos and testimonials only. Renders nothing while the data is empty. */
export function Proof() {
  const logos = LOGOS.filter((l) => l.src);
  const testimonials = TESTIMONIALS.filter((t) => t.quote);
  if (logos.length === 0 && testimonials.length === 0) return null;
  return (
    <section aria-labelledby="clientes-title" className={SECTION}>
      <Heading id="clientes-title" title="Negocios que ya venden con Vende+ WSP." />
      {logos.length > 0 ? (
        <Stagger className="m-0 mb-6 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 desk:grid-cols-5">
          {logos.map((logo) => (
            <StaggerItem key={logo.alt}><MediaSlot {...logo} sizes="240px" /></StaggerItem>
          ))}
        </Stagger>
      ) : null}
      {testimonials.length > 0 ? (
        <Stagger className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {testimonials.map((t) => (
            <StaggerItem key={t.name + t.quote} className="flex flex-col gap-4 rounded-[28px] border border-line bg-white p-5 sm:p-6">
              <blockquote className="m-0 text-ink-3">{t.quote}</blockquote>
              <div className="mt-auto flex items-center gap-3">
                {t.avatar.src ? <div className="w-14 shrink-0"><MediaSlot {...t.avatar} className="rounded-full grayscale" sizes="56px" /></div> : null}
                <div>
                  <p className="m-0 font-semibold">{t.name}</p>
                  <p className="m-0 text-sm text-muted">{t.role}</p>
                </div>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      ) : null}
    </section>
  );
}

/** No pricing route exists yet: shows owner copy when filled, otherwise a generic CTA to sign up. */
export function PricingTeaser() {
  const published = !PRICING_TEASER.from.includes("[") && !PRICING_TEASER.note.includes("[");
  return (
    <section id="precios" aria-labelledby="precios-title" className={SECTION}>
      <Reveal spring from="right" className="flex flex-col items-start gap-4 rounded-[32px] border border-line bg-white p-[clamp(20px,5vw,56px)]">
        <p className="m-0 rounded-full bg-lime px-3 py-1 text-sm font-bold">Precios</p>
        <h2 id="precios-title" className={`${H2} max-w-[24ch]`}>{published ? PRICING_TEASER.from : "Empieza gratis y elige tu plan cuando lo necesites."}</h2>
        <p className="m-0 max-w-[60ch] text-lg text-ink-3">
          {published ? PRICING_TEASER.note : "Crea tu cuenta, conecta tu WhatsApp y revisa los planes dentro de la app. Puedes cancelar en cualquier momento."}
        </p>
        <Link href="/signup" className={buttonClasses("primary", "", "lg")}>
          Ver planes al crear tu cuenta
          <ArrowRight aria-hidden className="size-5" />
        </Link>
      </Reveal>
    </section>
  );
}

export function Faq() {
  return (
    <section id="preguntas" aria-labelledby="preguntas-title" className={SECTION}>
      <Heading id="preguntas-title" title="Preguntas frecuentes." />
      <div className="rounded-[28px] bg-white px-6 py-2"><Accordion items={FAQ} /></div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className={SECTION}>
      <Reveal spring from="scale" className="flex flex-col gap-6 rounded-[32px] bg-lime p-[clamp(20px,5vw,56px)] text-ink sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="cta-title" className={`${H2} max-w-[16ch]`}>Que ningún mensaje se quede sin respuesta.</h2>
          <p className="mt-4 mb-0 max-w-[44ch]">Conecta tu WhatsApp, carga tu catálogo y empieza a atender con tu equipo y la IA.</p>
          <p className="mt-3 mb-0 text-sm">¿Ya tienes cuenta? <Link href="/login" className="font-bold text-ink underline underline-offset-4">Ingresar</Link> · <AssistantCta className="font-bold text-ink underline underline-offset-4">¿Dudas? Pregúntale al asistente</AssistantCta></p>
        </div>
        <ArrowLink magnetic href="/signup" aria-label="Crear cuenta gratis" className="grid size-16 shrink-0 place-items-center rounded-2xl border-2 border-ink text-ink no-underline transition-colors hover:bg-ink hover:text-lime sm:size-20">
          <ArrowNudge><ArrowUpRight className="size-8 sm:size-10" /></ArrowNudge>
        </ArrowLink>
      </Reveal>
    </section>
  );
}
