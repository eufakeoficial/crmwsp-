"use client";

import { useId, useRef, useState } from "react";
import { Reveal } from "./motion";
import { DISPLAY } from "./styles";

const PRESETS = [
  { label: "Equipo chico", msgs: 40, mins: 3 },
  { label: "Equipo mediano", msgs: 120, mins: 3 },
  { label: "Alto volumen", msgs: 400, mins: 2 },
] as const;
const CUSTOM = "Personalizado";
const DAYS = 30;

function clamp(raw: string, max: number): number {
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

const FIELD = "w-full rounded-2xl border border-line bg-paper-2 px-4 py-3 text-base text-ink outline-none focus-visible:border-ink";
const TAB = "min-h-11 min-w-11 cursor-pointer rounded-full px-5 text-sm font-bold";

/** Client-side savings estimator. Pure arithmetic on the inputs; nothing is sent anywhere. */
export function SavingsCalculator() {
  const [msgs, setMsgs] = useState("120");
  const [mins, setMins] = useState("3");
  const [pct, setPct] = useState(50);
  const msgsRef = useRef<HTMLInputElement>(null);
  const idMsgs = useId();
  const idMins = useId();
  const idPct = useId();

  const m = clamp(msgs, 5000);
  const t = clamp(mins, 120);
  const hoursNow = (m * DAYS * t) / 60;
  const saved = (hoursNow * pct) / 100;
  const active = PRESETS.find((p) => String(p.msgs) === msgs && String(p.mins) === mins)?.label ?? CUSTOM;

  return (
    <div>
      <Reveal spring y={36} className="rounded-[28px] bg-lime px-4 py-[clamp(28px,4vw,48px)] text-center text-ink sm:px-5">
        <h2 id="calculadora-title" className={`${DISPLAY} m-0 mx-auto max-w-[22ch] text-[clamp(1.5rem,1.1rem+1.8vw,2.5rem)] leading-[1.1] font-bold tracking-[-0.02em] text-balance`}>
          Calcula cuánto tiempo puede ahorrarte la IA.
        </h2>
        <div role="group" aria-label="Ejemplos de volumen" className="mt-6 flex flex-wrap justify-center gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={active === p.label}
              onClick={() => {
                setMsgs(String(p.msgs));
                setMins(String(p.mins));
              }}
              className={`${TAB} ${active === p.label ? "bg-ink text-white" : "bg-white text-ink hover:bg-white/80"}`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={active === CUSTOM}
            onClick={() => msgsRef.current?.focus()}
            className={`${TAB} ${active === CUSTOM ? "bg-ink text-white" : "bg-white text-ink hover:bg-white/80"}`}
          >
            {CUSTOM}
          </button>
        </div>
      </Reveal>

      <div className="mt-4 grid gap-4 desk:grid-cols-[1.6fr_1fr]">
        <Reveal spring y={40} delay={0.05} className="rounded-[28px] bg-white p-[clamp(20px,3vw,32px)] text-ink">
          <h3 className={`${DISPLAY} m-0 text-lg font-semibold`}>Calculadora de ahorro</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor={idMsgs} className="mb-1.5 block text-sm font-semibold text-ink-3">Mensajes por día</label>
              <input ref={msgsRef} id={idMsgs} className={FIELD} inputMode="numeric" value={msgs} onChange={(e) => setMsgs(e.target.value.replace(/[^\d]/g, "").slice(0, 4))} />
            </div>
            <div>
              <label htmlFor={idMins} className="mb-1.5 block text-sm font-semibold text-ink-3">Minutos por respuesta</label>
              <input id={idMins} className={FIELD} inputMode="decimal" value={mins} onChange={(e) => setMins(e.target.value.replace(/[^\d.,]/g, "").slice(0, 4))} />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={idPct} className="mb-1.5 flex justify-between gap-3 text-sm font-semibold text-ink-3">
                <span>Mensajes que resolvería la IA (supuesto)</span>
                <span className="text-ink">{pct}%</span>
              </label>
              <input id={idPct} type="range" min={10} max={90} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="h-11 w-full cursor-pointer accent-ink" />
            </div>
          </div>
          <p className="mt-4 mb-0 text-sm text-ink-3">Calculado sobre {DAYS} días al mes.</p>
        </Reveal>

        <Reveal spring y={40} delay={0.15} className="rounded-[28px] bg-white p-[clamp(20px,3vw,32px)] text-ink">
          <h3 className={`${DISPLAY} m-0 text-lg font-semibold`}>Estimación mensual</h3>
          <div aria-live="polite">
            <p className="mt-5 mb-0 text-sm text-ink-3">Tiempo dedicado a responder hoy</p>
            <p className={`${DISPLAY} m-0 text-3xl font-bold`}>
              {Math.round(hoursNow)}
              <span className="text-base font-medium text-ink-3"> h/mes</span>
            </p>
            <div className="mt-4 rounded-2xl bg-ink px-4 py-3 text-white">
              <p className="m-0 text-sm text-subtle">Horas que podrías liberar</p>
              <p className={`${DISPLAY} m-0 text-3xl font-bold text-lime`}>
                {Math.round(saved)}
                <span className="text-base font-medium text-white"> h/mes</span>
              </p>
            </div>
          </div>
          <p className="mt-4 mb-0 text-xs text-ink-3">Estimación orientativa con los datos que ingreses y el supuesto de {pct}%. No es una promesa de resultados.</p>
        </Reveal>
      </div>
    </div>
  );
}
