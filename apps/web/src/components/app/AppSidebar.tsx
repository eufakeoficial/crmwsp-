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
        "flex min-h-[34px] items-center gap-2.5 rounded-full px-3 py-0.5 text-[13px] no-underline",
        active ? "bg-lime font-extrabold text-ink" : "font-semibold text-white hover:bg-ink-2",
      )}
    >
      <Icon aria-hidden className="size-4 flex-none" />
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

function SubLinks({ items, pathname, counts, onNavigate }: { items: readonly NavItem[]; pathname: string; counts: NavCounts; onNavigate?: (() => void) | undefined }) {
  return (
    <div className="ml-5 flex flex-col gap-0.5 border-l border-ink-4 pl-2">
      {items.map((c) => (
        <SidebarLink key={c.key} item={c} active={isActive(pathname, c.href)} count={counts[c.key]} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

export function NavLinks({ counts = {}, onNavigate }: { counts?: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const render = (items: readonly NavItem[]) =>
    items.map((i) => (
      <div key={i.key} className="flex flex-col gap-0.5">
        <SidebarLink item={i} active={isActive(pathname, i.href) && !i.children} count={counts[i.key]} {...(onNavigate ? { onNavigate } : {})} />
        {i.children && isActive(pathname, i.href) ? <SubLinks items={i.children} pathname={pathname} counts={counts} onNavigate={onNavigate} /> : null}
      </div>
    ));
  return (
    <>
      {render(NAV_MAIN)}
      <span aria-hidden className="mx-2 my-2.5 h-px flex-none bg-ink-3" />
      {render(NAV_SECONDARY)}
    </>
  );
}

/** AI assistant card: links to the AI settings, where the assist mode (draft, human sends) is chosen. */
export function AssistantCard() {
  return (
    <div className="mt-auto flex flex-col items-start gap-2 rounded-[18px] bg-ink-2 p-3 text-white">
      <span className="grid size-8 place-items-center rounded-lg bg-lime text-ink">
        <Sparkles aria-hidden className="size-5" />
      </span>
      <b className="text-[13px]">Asistente de IA</b>
      <span className="text-[12px] text-subtle">Modo asistente: la IA redacta y tú envías.</span>
      <Link href="/app/settings/ai" className="text-[13px] font-bold text-lime no-underline hover:underline">
        Configurar la IA
      </Link>
    </div>
  );
}

/** Floating black sidebar (desktop, from the `desk` breakpoint). */
export function AppSidebar({ counts }: { counts?: NavCounts }) {
  return (
    <nav aria-label="Principal" className="fixed top-0 bottom-0 left-0 z-[25] hidden w-[220px] p-3 desk:block">
      <div className="flex h-full flex-col gap-1 overflow-y-auto rounded-[22px] bg-ink px-2.5 py-3.5 text-white [scrollbar-color:var(--color-ink-4)_transparent] [scrollbar-width:thin]">
        <Logo href="/app" inverted className="px-2 pb-3" />
        <NavLinks {...(counts ? { counts } : {})} />
        <AssistantCard />
      </div>
    </nav>
  );
}
