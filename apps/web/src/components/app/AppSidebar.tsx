"use client";

import { ChevronDown, Sparkles } from "lucide-react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { cn } from "@/lib/cn";
import { UserMenu } from "./UserMenu";
import { NAV_MAIN, NAV_MORE, NAV_SECONDARY, type NavItem, isActive, isMoreActive } from "./nav-items";

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
        active ? "bg-lime font-extrabold text-ink" : "font-semibold text-white hover:bg-white/10",
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
    <div className="ml-5 flex flex-col gap-0.5 border-l border-white/25 pl-2">
      {items.map((c) => (
        <SidebarLink key={c.key} item={c} active={isActive(pathname, c.href)} count={counts[c.key]} onNavigate={onNavigate} />
      ))}
    </div>
  );
}

export function NavLinks({ counts = {}, onNavigate }: { counts?: NavCounts; onNavigate?: () => void }) {
  const pathname = usePathname();
  const [moreToggled, setMoreToggled] = useState(false);
  // Expanded by default only when the current page lives inside the group.
  const moreOpen = moreToggled || isMoreActive(pathname);
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
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-expanded={moreOpen}
          aria-controls="nav-more"
          onClick={() => setMoreToggled((v) => !v)}
          className="flex min-h-[34px] w-full cursor-pointer items-center gap-2.5 rounded-full border-0 bg-transparent px-3 py-0.5 text-left text-[13px] font-semibold text-white hover:bg-white/10"
        >
          <ChevronDown aria-hidden className={cn("size-4 flex-none transition-transform", moreOpen ? "" : "-rotate-90")} />
          <span className="flex-1">Más</span>
        </button>
        {moreOpen ? (
          <div id="nav-more" className="ml-5 flex flex-col gap-0.5 border-l border-white/25 pl-2">
            {NAV_MORE.map((i) => (
              <SidebarLink key={i.key} item={i} active={isActive(pathname, i.href)} count={counts[i.key]} {...(onNavigate ? { onNavigate } : {})} />
            ))}
          </div>
        ) : null}
      </div>
      <span aria-hidden className="mx-2 my-2.5 h-px flex-none bg-white/20" />
      {render(NAV_SECONDARY)}
    </>
  );
}

/** AI assistant card: links to the AI settings, where the assist mode (draft, human sends) is chosen. */
export function AssistantCard() {
  return (
    <div className="mt-auto flex flex-col items-start gap-1.5 rounded-[18px] bg-white/10 p-3 text-white">
      <div className="flex items-center gap-2">
        <span className="grid size-7 flex-none place-items-center rounded-lg bg-lime text-ink">
          <Sparkles aria-hidden className="size-4" />
        </span>
        <b className="text-[13px]">Asistente de IA</b>
      </div>
      <span className="text-[12px] text-subtle">Modo asistente: la IA redacta y tú envías.</span>
      <Link href="/app/settings/ai" className="text-[13px] font-bold text-lime no-underline hover:underline">
        Configurar la IA
      </Link>
    </div>
  );
}

/** Narrow icon-only rail (desktop) used on full-bleed screens such as the inbox. Labels live in the tooltip. */
function AppRail({ counts = {} }: { counts?: NavCounts }) {
  const pathname = usePathname();
  const items = [...NAV_MAIN, ...NAV_MORE, ...NAV_SECONDARY];
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-y-0 left-0 z-[25] hidden w-[72px] flex-col items-center bg-brand-gradient py-3 desk:flex"
    >
      <Link href="/app" aria-label="CRMWSP, ir al inicio" title="CRMWSP" className="mb-2 flex-none rounded-xl no-underline">
        <LogoMark size={36} />
      </Link>
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto [scrollbar-width:none]">
      {items.map((item) => {
        const Icon = item.icon;
        const active = isActive(pathname, item.href);
        const count = counts[item.key];
        return (
          <Link
            key={item.key}
            href={item.href}
            title={item.label}
            aria-label={item.label}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative grid size-11 flex-none place-items-center rounded-xl no-underline",
              active ? "bg-lime text-ink" : "text-white hover:bg-white/10",
            )}
          >
            <Icon aria-hidden className="size-5" />
            {count ? (
              <span className="absolute top-0.5 right-0.5 min-w-4 rounded-full bg-alert px-1 text-center text-[10px] leading-4 font-extrabold text-white">
                {count}
                <span className="sr-only"> sin leer</span>
              </span>
            ) : null}
          </Link>
        );
      })}
      </div>
      <UserMenu placement="rail" className="pt-2 pb-10" />
    </nav>
  );
}

/** Floating navy-to-royal sidebar (desktop, from the `desk` breakpoint); `rail` swaps it for the icon-only rail. */
export function AppSidebar({ counts, rail = false }: { counts?: NavCounts; rail?: boolean }) {
  if (rail) return <AppRail {...(counts ? { counts } : {})} />;
  return (
    <nav aria-label="Principal" className="fixed top-0 bottom-0 left-0 z-[25] hidden w-[232px] p-3 desk:block">
      <div className="flex h-full flex-col gap-1 overflow-hidden rounded-[22px] bg-brand-gradient px-2.5 py-3.5 text-white">
        <Logo href="/app" inverted className="px-2 pb-3" />
        <NavLinks {...(counts ? { counts } : {})} />
        <AssistantCard />
      </div>
    </nav>
  );
}
