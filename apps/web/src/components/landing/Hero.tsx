import { ArrowRight, BookOpenCheck, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import { MEDIA } from "./media";
import { MediaSlot } from "./MediaSlot";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page py-3">
      <div className="relative grid items-center gap-10 overflow-hidden rounded-[28px] bg-ink px-[clamp(20px,5vw,64px)] py-[clamp(36px,6vw,80px)] text-white desk:grid-cols-[1fr_1.1fr]">
        {/* Neon glow, purely decorative */}
        <div aria-hidden className="pointer-events-none absolute -top-40 -left-32 size-[520px] rounded-full bg-lime/15 blur-[120px]" />
        <div className="relative">
          <p className="lp-rise m-0 mb-4 inline-flex items-center gap-2 rounded-full border border-ink-4 px-3 py-1 text-sm text-subtle">
            <span aria-hidden className="size-2 rounded-full bg-whatsapp" />
            CRM de WhatsApp con IA para negocios que cotizan
          </p>
          <h1 id="hero-title" className="lp-rise lp-rise-2 m-0 max-w-[16ch] text-[clamp(36px,5.4vw,68px)] leading-[1.03] font-extrabold tracking-[-0.035em]">
            Responde, cotiza y cobra <span className="text-lime">sin perder un mensaje</span>
          </h1>
          <p className="lp-rise lp-rise-3 mt-5 mb-0 max-w-[52ch] text-lg text-subtle">
            Un solo inbox de WhatsApp para todo tu equipo y una IA que contesta con tu catálogo, cita la fuente y pasa la conversación a una persona cuando no sabe.
          </p>
          <div className="lp-rise lp-rise-3 mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={buttonClasses("accent", "", "lg")}>
              Crear cuenta gratis
              <ArrowRight aria-hidden className="size-5" />
            </Link>
            <Link href="#como-funciona" className={buttonClasses("outline", "border-white bg-transparent text-white hover:bg-ink-2", "lg")}>Ver cómo funciona</Link>
          </div>
          <p className="lp-rise lp-rise-3 mt-5 mb-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-subtle">
            <ShieldCheck aria-hidden className="size-4 shrink-0 text-lime" />
            WhatsApp vía proveedor oficial. ¿Ya tienes cuenta?
            <Link href="/login" className="font-semibold text-white underline underline-offset-4">Ingresar</Link>
          </p>
        </div>
        <div className="lp-rise lp-rise-2 relative pb-6">
          <MediaSlot {...MEDIA.hero} priority className="border-ink-4 shadow-[0_0_80px_-20px_rgba(210,243,76,0.45)]" sizes="(min-width: 1100px) 640px, 100vw" />
          <div className="absolute bottom-0 left-3 max-w-[260px] rounded-2xl bg-white p-3 text-ink shadow-xl sm:-left-4">
            <p className="m-0 text-sm">Ejemplo de respuesta: el servicio incluye instalación y garantía.</p>
            <p className="m-0 mt-1.5 flex items-center gap-1.5 text-xs font-semibold text-success">
              <BookOpenCheck aria-hidden className="size-4" />
              Fuente: catálogo, ficha de servicio
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
