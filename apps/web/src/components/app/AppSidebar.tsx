"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/brand/Logo";
import { cn } from "@/lib/cn";
import { NAV_MAIN, NAV_SECONDARY, type NavItem, isActive } from "./nav-items";

/** Red counters per nav key, e.g. `{ inbox: 3 }`. Empty until real data exists. */
export type NavCounts = Readonly<Record<string, number>>;

export function SidebarLink({ item, active, count, onNavigate }: { item: NavItem; active: boolean; count?: number | undefined; onNavigate?: (() => void) | undefined }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      {...(onNavigate ? { onClick: onNavigate } : {})}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex min-h-[50px] items-center gap-3 rounded-full px-4 py-1 no-underline",
        active ? "bg-lime font-extrabold text-ink" : "font-semibold text-white hover:bg-ink-2",
      )}
    >
      <Icon aria-hidden className="size-5 flex-none" />
      <span className="flex-1 whitespace-nowrap">{item.label}</span>
      {count ? (
        <span className="rounded-full bg-alert px-2 text-[12px] font-extrabold text-white">
          {count}
          <span className="sr-only"> sin leer</span>
        </span>
      ) : null}
    </Link>
  );
}

export function NavLinks({ counts = {}, onNavigate }: { counts?: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const render = (items: readonly NavItem[]) =>
    items.map((i) => <SidebarLink key={i.key} item={i} active={isActive(pathname, i.href)} count={counts[i.key]} {...(onNavigate ? { onNavigate } : {})} />);
  return (
    <>
      {render(NAV_MAIN)}
      <span aria-hidden className="mx-2 my-2.5 h-px flex-none bg-ink-3" />
      {render(NAV_SECONDARY)}
    </>
  );
}

/** Reserved card for the AI assistant. Not interactive until the feature exists. */
export function AssistantCard() {
  return (
    <div className="mt-auto flex flex-col items-start gap-2 rounded-[22px] bg-ink-2 p-3.5 text-white">
      <span className="grid size-10 place-items-center rounded-xl bg-lime text-ink">
        <Sparkles aria-hidden className="size-5" />
      </span>
      <b className="text-[15px]">Asistente de IA</b>
      <span className="text-[13px] text-subtle">Próximamente: respuestas sugeridas con citas a tu catálogo.</span>
    </div>
  );
}

/** Floating black sidebar (desktop, from the `desk` breakpoint). */
export function AppSidebar({ counts }: { counts?: NavCounts }) {
  return (
    <nav aria-label="Principal" className="fixed top-0 bottom-0 left-0 z-[25] hidden w-[260px] p-3 desk:block">
      <div className="flex h-full flex-col gap-1 overflow-y-auto rounded-[28px] bg-ink px-3 py-[18px] text-white [scrollbar-color:var(--color-ink-4)_transparent] [scrollbar-width:thin]">
        <Logo href="/app" inverted className="px-2 pb-[18px]" />
        <NavLinks {...(counts ? { counts } : {})} />
        <AssistantCard />
      </div>
    </nav>
  );
}
