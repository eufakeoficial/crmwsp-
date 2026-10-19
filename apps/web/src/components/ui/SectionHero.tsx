import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TONE_BG, type Tone } from "./tones";

/** Dark section header: icon, eyebrow, title, subtitle and top actions. */
export function SectionHero({
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  actions,
  tone = "lime-soft",
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  tone?: Tone;
}) {
  return (
    <section className="relative flex flex-wrap items-center gap-4 overflow-hidden rounded-[28px] bg-ink p-[22px] text-white">
      <span aria-hidden className={cn("absolute -top-10 -right-[30px] size-[200px] rounded-full opacity-50", TONE_BG[tone])} />
      <span className="relative grid size-16 flex-none place-items-center rounded-[20px] bg-lime text-ink">
        <Icon aria-hidden className="size-[30px]" />
      </span>
      <div className="relative min-w-0 flex-[1_1_260px]">
        {eyebrow ? <span className="text-xs font-extrabold opacity-75">{eyebrow}</span> : null}
        <h2 className="m-0 text-[28px] tracking-[-0.03em]">{title}</h2>
        {subtitle ? <span className="opacity-85">{subtitle}</span> : null}
      </div>
      {actions ? <div className="relative flex flex-wrap gap-2">{actions}</div> : null}
    </section>
  );
}
