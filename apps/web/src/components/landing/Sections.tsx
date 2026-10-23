import {
  ArrowRight, Bot, BookOpenCheck, ChartNoAxesColumn, Check, HandHelping, Inbox, MessageSquareQuote, ReceiptText, ShieldCheck, UsersRound, WalletCards,
} from "lucide-react";
import Link from "next/link";
import { Accordion, buttonClasses } from "@/components/ui";
import { LOGOS, MEDIA, PRICING_TEASER, TESTIMONIALS, type MediaSpec } from "./media";
import { MediaSlot } from "./MediaSlot";

const H2 = "m-0 text-[clamp(28px,3.4vw,42px)] leading-[1.08] tracking-[-0.03em]";
const SECTION = "container-page scroll-mt-24 pb-[clamp(48px,7vw,96px)]";
const CARD = "flex flex-col gap-3 rounded-[22px] border border-line bg-white p-6 transition hover:-translate-y-0.5 hover:border-line-2";

function Heading({ id, eyebrow, title, lead }: { id: string; eyebrow: string; title: string; lead?: string }) {
  return (
    <header className="mb-8 max-w-[60ch]">
      <p className="m-0 mb-2 text-sm font-bold tracking-wide text-ink-3 uppercase">{eyebrow}</p>
      <h2 id={id} className={H2}>{title}</h2>
      {lead ? <p className="mt-3 mb-0 text-lg text-ink-3">{lead}</p> : null}
    </header>
  );
}

const TRUST = [
  { icon: BookOpenCheck, text: "IA que cita su fuente" },
  { icon: WalletCards, text: "Pagos verificados por el proveedor" },
  { icon: ShieldCheck, text: "WhatsApp vía proveedor oficial" },
  { icon: UsersRound, text: "Datos aislados por empresa" },
] as const;

/** Factual guarantees only; real customer logos/testimonials live in `Proof`. */
export function TrustStrip() {
  return (
    <section aria-label="Garantías del producto" className="container-page py-6">
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 desk:grid-cols-4">
        {TRUST.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-sm font-semibold">
            <Icon aria-hidden className="size-5 shrink-0 text-success" />
            {text}
          </li>
        ))}
      </ul>
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
    <section id="problemas" aria-labelledby="problemas-title" className={`${SECTION} pt-[clamp(40px,6vw,80px)]`}>
      <Heading id="problemas-title" eyebrow="El problema" title="Del caos del chat al pedido cerrado" lead="Vender por WhatsApp funciona hasta que el equipo crece. Entonces se pierden mensajes, precios y cobros." />
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
        {PAINS.map(({ pain, solution }) => (
          <li key={pain} className="flex flex-col gap-3 rounded-[22px] border border-line bg-white p-6">
            <p className="m-0 text-ink-3 line-through decoration-1">{pain}</p>
            <p className="m-0 flex items-start gap-2 font-semibold"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />{solution}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FEATURES = [
  { icon: Inbox, title: "Inbox de WhatsApp", text: "Todos los números y conversaciones en una bandeja compartida, con historial por cliente." },
  { icon: Bot, title: "IA con tu catálogo", text: "Responde con tus productos y precios y cita la fuente de cada dato." },
  { icon: HandHelping, title: "Deriva a una persona", text: "Si no encuentra el dato o el cliente lo pide, pasa la conversación a tu equipo." },
  { icon: MessageSquareQuote, title: "Playbook de ventas", text: "Define tono, reglas y objeciones una vez; la IA y el equipo las siguen." },
  { icon: ReceiptText, title: "Presupuestos y pedidos", text: "Crea y envía el presupuesto desde la conversación y sigue el pedido." },
  { icon: WalletCards, title: "Pagos verificados", text: "Un pago se marca como pagado por confirmación del proveedor, nunca por una captura." },
  { icon: UsersRound, title: "Equipo y roles", text: "Cada persona ve lo que le corresponde. Los datos de cada empresa están aislados." },
  { icon: ChartNoAxesColumn, title: "Ejecuciones y medición", text: "Revisa qué hizo la IA, qué conversaciones necesitan atención y cómo avanzan tus ventas." },
] as const;

export function Features() {
  return (
    <section id="beneficios" aria-labelledby="beneficios-title" className={SECTION}>
      <Heading id="beneficios-title" eyebrow="Qué incluye" title="Todo lo que tu equipo necesita para vender por WhatsApp" />
      <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 desk:grid-cols-4">
        {FEATURES.map(({ icon: Icon, title, text }) => (
          <li key={title} className={CARD}>
            <span className="grid size-12 place-items-center rounded-2xl bg-lime text-ink"><Icon aria-hidden className="size-6" /></span>
            <h3 className="m-0 text-[18px]">{title}</h3>
            <p className="m-0 text-ink-3">{text}</p>
          </li>
        ))}
      </ul>
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
    <section aria-label="Funciones destacadas" className={`${SECTION} flex flex-col gap-[clamp(40px,6vw,88px)]`}>
      {SHOWCASE.map(({ media, eyebrow, title, text, bullets }, i) => (
        <div key={title} className="grid items-center gap-8 desk:grid-cols-2 desk:gap-14">
          <div className={i % 2 === 1 ? "desk:order-2" : undefined}>
            <MediaSlot {...media} className="shadow-[0_24px_60px_-30px_rgba(18,18,18,0.45)]" sizes="(min-width: 1100px) 560px, 100vw" />
          </div>
          <div>
            <p className="m-0 mb-2 text-sm font-bold tracking-wide text-ink-3 uppercase">{eyebrow}</p>
            <h3 className="m-0 text-[clamp(24px,2.8vw,34px)] leading-[1.12] tracking-[-0.025em]">{title}</h3>
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
        </div>
      ))}
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
      <div className="rounded-[28px] bg-ink px-[clamp(20px,5vw,64px)] py-[clamp(36px,6vw,72px)] text-white">
        <header className="mb-8 max-w-[60ch]">
          <p className="m-0 mb-2 text-sm font-bold tracking-wide text-lime uppercase">Por qué confiar</p>
          <h2 id="diferenciales-title" className={H2}>Automatiza sin arriesgar la palabra de tu negocio</h2>
        </header>
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {DIFFERENTIATORS.map(({ icon: Icon, title, text }) => (
            <li key={title} className="flex flex-col gap-3 rounded-[22px] border border-ink-4 bg-ink-2 p-6">
              <span className="grid size-12 place-items-center rounded-2xl bg-lime text-ink"><Icon aria-hidden className="size-6" /></span>
              <h3 className="m-0 text-[18px]">{title}</h3>
              <p className="m-0 text-subtle">{text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const STEPS = [
  { title: "Conecta tu número", text: "Vincula tu WhatsApp Business mediante un proveedor oficial de la API." },
  { title: "Carga tu catálogo y tu playbook", text: "Sube productos, precios y reglas de venta: son la fuente de la IA." },
  { title: "Atiende con tu equipo y la IA", text: "La IA responde con cita; tu equipo toma el control cuando hace falta." },
  { title: "Cotiza y cobra", text: "Envía el presupuesto y cobra; el pago se marca al confirmarlo el proveedor." },
] as const;

export function HowItWorks() {
  return (
    <section id="como-funciona" aria-labelledby="como-title" className={SECTION}>
      <Heading id="como-title" eyebrow="Cómo funciona" title="Listo para atender en cuatro pasos" />
      <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 desk:grid-cols-4">
        {STEPS.map(({ title, text }, index) => (
          <li key={title} className={CARD}>
            <span aria-hidden className="grid size-10 place-items-center rounded-full bg-ink font-extrabold text-lime">{index + 1}</span>
            <h3 className="m-0 text-[18px]"><span className="sr-only">Paso {index + 1}: </span>{title}</h3>
            <p className="m-0 text-ink-3">{text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function DemoVideo() {
  return (
    <section id="demo" aria-labelledby="demo-title" className={SECTION}>
      <Heading id="demo-title" eyebrow="Demo" title="Míralo en acción" lead="De un mensaje de WhatsApp a un presupuesto cobrado, todo conectado en un solo flujo." />
      <MediaSlot {...MEDIA.demoVideo} className="mx-auto max-w-[1000px] border-ink-4 shadow-[0_0_80px_-24px_rgba(210,243,76,0.5)]" sizes="(min-width: 1100px) 1000px, 100vw" />
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
      <Heading id="clientes-title" eyebrow="Clientes" title="Negocios que ya venden con CRMWSP" />
      {logos.length > 0 ? (
        <ul className="m-0 mb-6 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-3 desk:grid-cols-5">
          {logos.map((logo) => (
            <li key={logo.alt}><MediaSlot {...logo} sizes="240px" /></li>
          ))}
        </ul>
      ) : null}
      {testimonials.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-3">
          {testimonials.map((t) => (
            <li key={t.name + t.quote} className="flex flex-col gap-4 rounded-[22px] border border-line bg-white p-6">
              <blockquote className="m-0 text-ink-3">{t.quote}</blockquote>
              <div className="mt-auto flex items-center gap-3">
                {t.avatar.src ? <div className="w-14 shrink-0"><MediaSlot {...t.avatar} className="rounded-full" sizes="56px" /></div> : null}
                <div>
                  <p className="m-0 font-semibold">{t.name}</p>
                  <p className="m-0 text-sm text-muted">{t.role}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** No pricing route exists yet: shows owner copy when filled, otherwise a generic CTA to sign up. */
export function PricingTeaser() {
  const published = !PRICING_TEASER.from.includes("[") && !PRICING_TEASER.note.includes("[");
  return (
    <section id="precios" aria-labelledby="precios-title" className={SECTION}>
      <div className="flex flex-col items-start gap-4 rounded-[28px] bg-lime-soft p-[clamp(24px,5vw,56px)]">
        <p className="m-0 text-sm font-bold tracking-wide text-ink-3 uppercase">Precios</p>
        <h2 id="precios-title" className={H2}>{published ? PRICING_TEASER.from : "Empieza gratis y elige tu plan cuando lo necesites"}</h2>
        <p className="m-0 max-w-[60ch] text-lg text-ink-3">
          {published ? PRICING_TEASER.note : "Crea tu cuenta, conecta tu WhatsApp y revisa los planes dentro de la app. Puedes cancelar en cualquier momento."}
        </p>
        <Link href="/signup" className={buttonClasses("primary", "", "lg")}>
          Ver planes al crear tu cuenta
          <ArrowRight aria-hidden className="size-5" />
        </Link>
      </div>
    </section>
  );
}

const FAQ = [
  { question: "¿Necesito un número nuevo de WhatsApp?", answer: "Conectas tu número a través de un proveedor oficial de la API de WhatsApp Business. Te guiamos en el proceso." },
  { question: "¿La IA puede dar precios equivocados?", answer: "No: solo afirma precios, stock o plazos si puede citar tu catálogo. Si no, deriva la conversación a una persona." },
  { question: "¿Cómo se confirman los pagos?", answer: "Solo por la confirmación del proveedor de pagos o por conciliación. Una imagen de comprobante nunca marca un pago como pagado." },
  { question: "¿Mis datos están separados de los de otras empresas?", answer: "Sí. Cada empresa trabaja en su propio espacio aislado y las claves se guardan cifradas." },
  { question: "¿Qué es BYOK y por qué importa?", answer: "Puedes usar tu propia clave de IA (BYOK) y pagar el consumo directo al proveedor, sin margen nuestro sobre la IA." },
  { question: "¿Puedo cancelar cuando quiera?", answer: "Sí. Puedes cancelar tu suscripción en cualquier momento desde tu cuenta." },
] as const;

export function Faq() {
  return (
    <section id="preguntas" aria-labelledby="preguntas-title" className={SECTION}>
      <Heading id="preguntas-title" eyebrow="Dudas" title="Preguntas frecuentes" />
      <div className="rounded-[22px] bg-white px-6 py-2"><Accordion items={FAQ} /></div>
    </section>
  );
}

export function FinalCta() {
  return (
    <section aria-labelledby="cta-title" className={SECTION}>
      <div className="relative overflow-hidden rounded-[28px] bg-ink px-[clamp(20px,5vw,64px)] py-[clamp(36px,6vw,72px)] text-white">
        <div aria-hidden className="pointer-events-none absolute -right-24 -bottom-40 size-[460px] rounded-full bg-lime/15 blur-[110px]" />
        <div className="relative">
          <BookOpenCheck aria-hidden className="mb-4 size-8 text-lime" />
          <h2 id="cta-title" className={`${H2} max-w-[20ch]`}>Que ningún mensaje se quede sin respuesta</h2>
          <p className="mt-4 mb-0 max-w-[52ch] text-lg text-subtle">Conecta tu WhatsApp, carga tu catálogo y empieza a atender con tu equipo y la IA.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClasses("accent", "", "lg")}>
              Crear cuenta gratis
              <ArrowRight aria-hidden className="size-5" />
            </Link>
            <Link href="/login" className={buttonClasses("outline", "border-white bg-transparent text-white hover:bg-ink-2", "lg")}>Ingresar</Link>
          </div>
        </div>
      </div>
    </section>
  );
}
