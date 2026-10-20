import { ArrowRight, Bot, MessageCircle, ReceiptText, ShieldCheck, Users } from "lucide-react";
import { cookies } from "next/headers";
import Link from "next/link";
import { PricingSection } from "@/components/landing/PricingSection";
import { SiteFooter } from "@/components/site/SiteFooter";
import { SiteHeader } from "@/components/site/SiteHeader";
import { Accordion, buttonClasses } from "@/components/ui";

// Keep in sync with SESSION_COOKIE in apps/api/src/auth/session-token.ts (presence check only).
const SESSION_COOKIE = "__Host-crmwsp_session";

const BENEFITS = [
  { icon: MessageCircle, title: "Todo tu WhatsApp", text: "Un inbox compartido para todo el equipo, con el historial de cada cliente." },
  { icon: ReceiptText, title: "Presupuestos y cobros", text: "Envía presupuestos y cobra sin teclear: el pago se confirma solo." },
  { icon: Bot, title: "IA que no inventa", text: "Respuestas sugeridas con cita a tu catálogo; si no hay dato, lo deriva a una persona." },
  { icon: Users, title: "Equipo y roles", text: "Cada persona ve lo que le corresponde. Los datos de cada empresa están aislados." },
] as const;

const PAINS = [
  { pain: "Mensajes perdidos entre chats personales y celulares del equipo", solution: "Un inbox compartido con historial por cliente y asignación." },
  { pain: "Cotizar a mano y perseguir el pago después", solution: "Presupuestos y pedidos desde la conversación; el pago se confirma solo." },
  { pain: "Un bot que inventa precios y compromete a tu negocio", solution: "IA que cita tu catálogo o deriva a una persona." },
  { pain: "Clientes que no vuelven porque nadie les da seguimiento", solution: "CRM kanban con seguimientos y difusiones para reactivar." },
] as const;

const STEPS = [
  { title: "Conecta tu número", text: "Vincula tu WhatsApp Business mediante un proveedor oficial de la API." },
  { title: "Carga tu catálogo", text: "Sube productos, precios y condiciones: es la fuente de la IA." },
  { title: "Atiende con tu equipo y la IA", text: "La IA sugiere respuestas con cita; tu equipo aprueba o toma el control." },
  { title: "Cotiza y cobra", text: "Envía presupuestos y cobra; el pago se marca al confirmarlo el proveedor." },
] as const;

const FAQ = [
  { question: "¿Necesito un número nuevo de WhatsApp?", answer: "Conectas tu número a través de un proveedor oficial de la API de WhatsApp Business. Te guiamos en el proceso." },
  { question: "¿La IA puede dar precios equivocados?", answer: "No: solo afirma precios, stock o plazos si puede citar tu catálogo. Si no, deriva la conversación a una persona." },
  { question: "¿Cómo se confirman los pagos?", answer: "Solo por la confirmación del proveedor de pagos o por conciliación. Una imagen de comprobante nunca marca un pago como pagado." },
  { question: "¿Mis datos están separados de los de otras empresas?", answer: "Sí. Cada empresa trabaja en su propio espacio aislado y las claves se guardan cifradas." },
  { question: "¿Qué es BYOK y por qué importa?", answer: "Puedes usar tu propia clave de IA (BYOK). Pagas el consumo directo al proveedor, sin margen nuestro sobre la IA." },
  { question: "¿La IA puede marcar un pago como pagado con una captura?", answer: "Nunca. Solo una persona o el webhook del proveedor de pagos confirman un pago; una captura no basta." },
  { question: "¿Qué diferencia hay entre Start y Pro?", answer: "Pro suma más números, usuarios y contactos, además de difusiones, atribución de ROAS de Meta Ads, API pública, webhooks e integraciones con Stripe y Shopify." },
  { question: "¿Cómo funciona el plan anual?", answer: "Pagas 10 meses y usas 12: dos meses gratis frente al plan mensual." },
  { question: "¿Puedo añadir más números de WhatsApp?", answer: "Sí, cada número adicional cuesta US$29 al mes sobre cualquiera de los planes." },
  { question: "¿Puedo cancelar cuando quiera?", answer: "Sí. Puedes cancelar tu suscripción en cualquier momento desde tu cuenta." },
] as const;

export default async function HomePage() {
  const hasSession = (await cookies()).has(SESSION_COOKIE);
  return (
    <>
      <SiteHeader hasSession={hasSession} />
      <main>
        <section className="container-page py-3">
          <div className="rounded-[28px] bg-ink px-[clamp(20px,5vw,64px)] py-[clamp(40px,7vw,96px)] text-white">
            <h1 className="m-0 max-w-[18ch] text-[clamp(36px,5.6vw,72px)] leading-[1.03] font-extrabold tracking-[-0.035em]">
              Todo tu <span className="text-lime">WhatsApp</span>, presupuestos y cobros en un solo lugar
            </h1>
            <p className="mt-5 mb-0 max-w-[56ch] text-lg text-subtle">Atiende, cotiza y cobra desde una sola bandeja, con una IA que cita tu catálogo en lugar de inventar.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={buttonClasses("accent", "", "lg")}>
                Crear cuenta gratis
                <ArrowRight aria-hidden className="size-5" />
              </Link>
              <Link href="/login" className={buttonClasses("outline", "border-white bg-transparent text-white hover:bg-ink-2", "lg")}>Ingresar</Link>
            </div>
          </div>
        </section>
        <section id="beneficios" aria-labelledby="beneficios-title" className="container-page scroll-mt-24 py-[clamp(40px,6vw,80px)]">
          <h2 id="beneficios-title" className="m-0 mb-8 text-[clamp(28px,3.4vw,40px)] tracking-[-0.03em]">Menos tecleo, más ventas</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 desk:grid-cols-4">
            {BENEFITS.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex flex-col gap-3 rounded-[22px] border border-line bg-white p-6">
                <span className="grid size-12 place-items-center rounded-2xl bg-lime text-ink"><Icon aria-hidden className="size-6" /></span>
                <h3 className="m-0 text-[18px]">{title}</h3>
                <p className="m-0 text-ink-3">{text}</p>
              </li>
            ))}
          </ul>
        </section>
        <section id="problemas" aria-labelledby="problemas-title" className="container-page scroll-mt-24 pb-[clamp(40px,6vw,80px)]">
          <h2 id="problemas-title" className="m-0 mb-8 text-[clamp(28px,3.4vw,40px)] tracking-[-0.03em]">Del caos al pedido cerrado</h2>
          <ul className="m-0 grid list-none grid-cols-1 gap-4 p-0 md:grid-cols-2">
            {PAINS.map(({ pain, solution }) => (
              <li key={pain} className="flex flex-col gap-2 rounded-[22px] border border-line bg-white p-6">
                <p className="m-0 text-ink-3 line-through decoration-1">{pain}</p>
                <p className="m-0 flex items-start gap-2 font-semibold"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0" />{solution}</p>
              </li>
            ))}
          </ul>
        </section>
        <section id="como-funciona" aria-labelledby="como-title" className="container-page scroll-mt-24 pb-[clamp(40px,6vw,80px)]">
          <h2 id="como-title" className="m-0 mb-8 text-[clamp(28px,3.4vw,40px)] tracking-[-0.03em]">Cómo funciona</h2>
          <ol className="m-0 grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 desk:grid-cols-4">
            {STEPS.map(({ title, text }, index) => (
              <li key={title} className="flex flex-col gap-3 rounded-[22px] border border-line bg-white p-6">
                <span className="grid size-10 place-items-center rounded-full bg-lime font-extrabold text-ink">{index + 1}</span>
                <h3 className="m-0 text-[18px]">{title}</h3>
                <p className="m-0 text-ink-3">{text}</p>
              </li>
            ))}
          </ol>
        </section>
        <PricingSection />
        <section id="preguntas" aria-labelledby="preguntas-title" className="container-page scroll-mt-24 pb-[clamp(40px,6vw,80px)]">
          <h2 id="preguntas-title" className="m-0 mb-4 text-[clamp(28px,3.4vw,40px)] tracking-[-0.03em]">Preguntas frecuentes</h2>
          <div className="rounded-[22px] bg-white px-6 py-2"><Accordion items={FAQ} /></div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
