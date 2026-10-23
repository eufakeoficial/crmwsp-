import { ArrowUpRight, Check } from "lucide-react";
import Link from "next/link";
import { SavingsCalculator } from "./Calculator";
import { DISPLAY, PILL_OUTLINE } from "./styles";

const CHECKS = [
  { text: "Respuestas con IA y fuente citada", highlight: false },
  { text: "Pagos confirmados por el proveedor", highlight: true },
  { text: "Pasa a una persona cuando no sabe", highlight: false },
  { text: "Datos aislados por empresa", highlight: false },
] as const;

const STATS = [
  { value: "24/7", label: "Respuestas con IA" },
  { value: "100%", label: "Pagos verificados por el proveedor" },
  { value: "1", label: "Bandeja para todo el equipo" },
] as const;

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="overflow-hidden rounded-b-[clamp(28px,4vw,48px)] bg-[linear-gradient(180deg,#050a3a_0%,#0a1696_55%,#1233d8_100%)] pb-[clamp(32px,5vw,64px)] text-white">
      <div className="container-page pt-[clamp(36px,6vw,80px)]">
        <div className="grid gap-8 desk:grid-cols-[1.6fr_1fr] desk:items-start">
          <div>
            <p className="lp-rise m-0 mb-4 text-sm font-semibold tracking-wide text-white/80 uppercase">CRM de WhatsApp con IA para negocios que cotizan</p>
            <h1 id="hero-title" className={`${DISPLAY} lp-rise lp-rise-2 m-0 text-[clamp(34px,7.2vw,92px)] leading-[1.02] font-bold tracking-[-0.03em] text-balance [overflow-wrap:anywhere]`}>
              Vende más por WhatsApp<span className="text-lime">.</span>
            </h1>
          </div>
          <ul className="lp-rise lp-rise-3 m-0 flex list-none flex-col gap-1.5 p-0 text-sm desk:mt-6">
            {CHECKS.map(({ text, highlight }) => (
              <li key={text} className={`flex items-center gap-2 rounded-md px-2 py-1.5 ${highlight ? "bg-lime font-bold text-ink" : "text-white/90"}`}>
                <Check aria-hidden className={`size-4 shrink-0 ${highlight ? "text-ink" : "text-lime"}`} />
                {text}
              </li>
            ))}
          </ul>
        </div>

        <div className="lp-rise lp-rise-3 mt-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <Link href="/signup" className={`${PILL_OUTLINE} border-white/70 text-white`}>
            Crear cuenta gratis
            <ArrowUpRight aria-hidden className="size-5" />
          </Link>
          <p className="m-0 max-w-[40ch] text-sm text-white/80">
            Un solo inbox, una IA que cita tu catálogo y cobros confirmados. ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="font-semibold text-white underline underline-offset-4">Ingresar</Link>
          </p>
        </div>

        <dl className="lp-rise lp-rise-3 m-0 mt-[clamp(32px,5vw,56px)] grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STATS.map(({ value, label }) => (
            <div key={label} className="flex flex-col-reverse">
              <dt className="text-sm text-white/80">{label}</dt>
              <dd className={`${DISPLAY} m-0 text-[clamp(26px,3vw,36px)] font-semibold`}>{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-[clamp(32px,5vw,64px)]">
          <SavingsCalculator />
        </div>
      </div>
    </section>
  );
}
