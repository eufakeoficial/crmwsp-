import { MessageCircle, ReceiptText, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { Logo } from "./brand/Logo";
import { Card } from "./ui";

const BENEFITS = [
  { icon: MessageCircle, text: "Todo tu WhatsApp en un solo lugar" },
  { icon: ReceiptText, text: "Presupuestos y cobros sin teclear" },
  { icon: ShieldCheck, text: "IA que no inventa precios" },
] as const;

/** Split layout: white form card + black brand panel (hidden on mobile). */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid min-h-dvh w-full max-w-[1280px] gap-3 p-3 desk:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col justify-center gap-6 px-1 py-6 sm:px-6">
        <Logo href="/" className="self-center desk:self-start" />
        <Card className="mx-auto w-full max-w-md desk:mx-0">
          <h1 className="m-0 text-[clamp(26px,3vw,32px)] leading-[1.15] font-extrabold tracking-[-0.02em]">{title}</h1>
          {subtitle ? <p className="mt-1 mb-0 text-muted">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </Card>
      </div>
      <aside aria-label="Beneficios de CRMWSP" className="hidden flex-col justify-between gap-10 rounded-[28px] bg-ink p-10 text-white desk:flex">
        <p className="m-0 max-w-[14ch] text-[clamp(36px,4vw,52px)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          Vende más desde tu <span className="text-lime">WhatsApp</span>
        </p>
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {BENEFITS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3.5 rounded-[20px] bg-ink-2 p-4">
              <span className="grid size-11 flex-none place-items-center rounded-xl bg-lime text-ink">
                <Icon aria-hidden className="size-5" />
              </span>
              <span className="text-[17px] font-bold">{text}</span>
            </li>
          ))}
        </ul>
      </aside>
    </main>
  );
}
