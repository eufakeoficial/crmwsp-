import { Mic, Phone, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const Bubble = ({ children, mine, className }: { children: ReactNode; mine?: boolean; className?: string }) => (
  <div
    className={cn(
      "max-w-[80%] rounded-xl px-2.5 py-1.5 text-[11px] leading-tight",
      mine ? "self-end bg-lime text-ink" : "self-start bg-white text-ink shadow-sm",
      className,
    )}
  >
    {children}
  </div>
);

export function SourcesMock() {
  return (
    <div className="flex flex-col gap-1.5">
      <Bubble>¿Cuánto cuesta el pack básico?</Bubble>
      <Bubble mine>
        Son 120 €.
        <span className="mt-1 block rounded bg-ink/10 px-1.5 py-0.5 text-[10px] font-bold">Fuente: Catálogo · Pack básico</span>
      </Bubble>
    </div>
  );
}

export function QuoteMock() {
  return (
    <div className="mx-auto w-[85%] rounded-xl bg-white p-2.5 text-[11px] shadow-sm">
      <div className="flex justify-between font-extrabold"><span>Presupuesto</span><span>#0042</span></div>
      <div className="mt-1.5 flex justify-between text-muted"><span>Instalación</span><span>240 €</span></div>
      <div className="flex justify-between text-muted"><span>Materiales</span><span>85 €</span></div>
      <div className="mt-1.5 flex items-center justify-between border-t border-line pt-1.5 font-extrabold">
        <span>325 €</span>
        <span className="rounded-full bg-ink px-2 py-0.5 text-[10px] text-white">Pagar</span>
      </div>
    </div>
  );
}

export function OrdersMock() {
  return (
    <div className="flex items-center justify-center gap-2">
      <div className="flex flex-col gap-1.5">
        {["Audio", "Foto", "PDF"].map((t) => (
          <span key={t} className="rounded-md bg-white px-2 py-1 text-[10px] font-bold shadow-sm">{t}</span>
        ))}
      </div>
      <Sparkles aria-hidden className="size-5 text-ink" />
      <div className="rounded-lg bg-white p-2 text-[10px] shadow-sm">
        <b>Pedido</b>
        <div className="text-muted">3 × Tubo PVC</div>
        <div className="text-muted">1 × Codo</div>
      </div>
    </div>
  );
}

const WAVE = [4, 9, 14, 8, 18, 12, 6, 16, 10, 5, 13, 8, 4];

export function VoiceMock() {
  return (
    <div className="mx-auto flex w-[85%] items-center gap-2 rounded-full bg-white px-3 py-2 shadow-sm">
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ink text-white"><Mic aria-hidden className="size-3.5" /></span>
      <div aria-hidden className="flex h-5 flex-1 items-center gap-[3px]">
        {WAVE.map((h, i) => (
          <span key={i} className="w-[3px] rounded-full bg-ink" style={{ height: h }} />
        ))}
      </div>
      <span className="text-[10px] font-bold text-muted">0:12</span>
    </div>
  );
}

export function SimulatorMock() {
  return (
    <div className="flex flex-col gap-1.5">
      <Bubble mine>Hola, quiero un presupuesto</Bubble>
      <Bubble>Claro, ¿para qué fecha lo necesitas?</Bubble>
      <Bubble className="text-muted">escribiendo…</Bubble>
    </div>
  );
}

export function OwnerMock() {
  return (
    <div className="mx-auto flex w-[55%] flex-col gap-1.5 rounded-2xl border-2 border-ink bg-white p-2">
      <Phone aria-hidden className="mx-auto size-3 text-muted" />
      <Bubble mine className="max-w-full">Ventas de hoy</Bubble>
      <Bubble className="max-w-full bg-paper">3 pedidos · 640 €</Bubble>
    </div>
  );
}
