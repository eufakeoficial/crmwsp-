import { AlertCircle, BookOpen, Bot, ClipboardCheck, FlaskConical, History, type LucideIcon, Mic, Package, Smartphone, Target, UserRound, Wallet, Wand2 } from "lucide-react";
import Link from "next/link";
import { AI_CAPABILITIES, type CapabilityKey } from "@/lib/ai-capabilities";

/** Icon and tint per capability so the grid scans visually instead of as a wall of text. */
const LOOK: Record<CapabilityKey, { icon: LucideIcon; tint: string }> = {
  mode: { icon: Bot, tint: "bg-royal-soft text-royal" },
  knowledge: { icon: BookOpen, tint: "bg-lime-soft text-success" },
  handoff: { icon: UserRound, tint: "bg-gold-soft text-amber-ink" },
  attention: { icon: AlertCircle, tint: "bg-danger-soft text-danger" },
  runs: { icon: History, tint: "bg-info-soft text-info" },
  playbook: { icon: Target, tint: "bg-royal-soft text-royal" },
  approvals: { icon: ClipboardCheck, tint: "bg-success-soft text-success" },
  simulator: { icon: FlaskConical, tint: "bg-lime-soft text-success" },
  budget: { icon: Wallet, tint: "bg-gold-soft text-amber-ink" },
  voice: { icon: Mic, tint: "bg-info-soft text-info" },
  improve: { icon: Wand2, tint: "bg-royal-soft text-royal" },
  orders: { icon: Package, tint: "bg-gold-soft text-amber-ink" },
  owner: { icon: Smartphone, tint: "bg-success-soft text-success" },
};

/** "Qué hace tu IA": compact icon grid, one tile per capability, with status and a direct link. */
export function AiCapabilities({ status }: { status: Record<CapabilityKey, boolean | null> | null }) {
  const tracked = AI_CAPABILITIES.filter((c) => status?.[c.key] !== null && status?.[c.key] !== undefined);
  const active = tracked.filter((c) => status?.[c.key]).length;
  return (
    <section aria-labelledby="ai-capabilities-title" className="mt-8">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="ai-capabilities-title" className="m-0 text-[19px]">
            Qué hace tu IA
          </h2>
          <p className="m-0 mt-1 text-[13px] text-muted">Toca una función para configurarla.</p>
        </div>
        {status && tracked.length > 0 ? (
          <div className="flex items-center gap-2 text-[13px] font-bold">
            <span aria-hidden className="h-2 w-28 overflow-hidden rounded-full bg-line">
              <span className="block h-full rounded-full bg-lime" style={{ width: `${Math.round((active / tracked.length) * 100)}%` }} />
            </span>
            {active} de {tracked.length} activas
          </div>
        ) : null}
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-2.5 p-0 sm:grid-cols-2 lg:grid-cols-3 desk:grid-cols-4">
        {AI_CAPABILITIES.map((c) => {
          const on = status?.[c.key];
          const { icon: Icon, tint } = LOOK[c.key];
          return (
            <li key={c.key} className="flex">
              <Link
                href={c.href}
                title={c.text}
                className="group flex w-full flex-col gap-2.5 rounded-2xl border border-line bg-white p-3.5 text-ink no-underline transition hover:-translate-y-0.5 hover:border-ink hover:shadow-[0_10px_30px_rgba(18,18,18,.08)]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`grid size-10 place-items-center rounded-xl ${tint}`}>
                    <Icon aria-hidden className="size-5" />
                  </span>
                  {on === null || on === undefined ? null : (
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${on ? "bg-success-soft text-success" : "bg-paper text-muted"}`}>
                      <span aria-hidden className={`size-1.5 rounded-full ${on ? "bg-success" : "bg-line-2"}`} />
                      {on ? "Activo" : "Inactivo"}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <h3 className="m-0 text-[14px] leading-tight font-extrabold">{c.title}</h3>
                  <p className="m-0 line-clamp-2 text-[12px] leading-snug text-muted">{c.text}</p>
                </div>
                <span className="mt-auto text-[12px] font-bold text-royal group-hover:underline">{c.linkLabel} →</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
