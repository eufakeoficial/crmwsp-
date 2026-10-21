import { ArrowRight, BookOpenCheck } from "lucide-react";
import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import { MEDIA } from "./media";
import { MediaSlot } from "./MediaSlot";

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="container-page py-3">
      <div className="grid items-center gap-10 overflow-hidden rounded-[28px] bg-ink px-[clamp(20px,5vw,64px)] py-[clamp(36px,6vw,80px)] text-white desk:grid-cols-[1.05fr_1fr]">
        <div>
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
            <Link href="/login" className={buttonClasses("outline", "border-white bg-transparent text-white hover:bg-ink-2", "lg")}>Ingresar</Link>
          </div>
        </div>
        <div className="lp-rise lp-rise-2 relative pb-4">
          <MediaSlot {...MEDIA.hero} priority className="border-ink-4" />
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
