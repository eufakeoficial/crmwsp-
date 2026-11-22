"use client";

import { CalendarDays, Contact, Gauge, Inbox, Menu, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { isActive } from "./nav-items";

const TABS: readonly { key: string; label: string; href: string; icon: LucideIcon }[] = [
  { key: "home", label: "Inicio", href: "/app", icon: Gauge },
  { key: "inbox", label: "Inbox", href: "/app/inbox", icon: Inbox },
  { key: "contacts", label: "Contactos", href: "/app/contacts", icon: Contact },
  { key: "agenda", label: "Agenda", href: "/app/agenda", icon: CalendarDays },
];

const ITEM = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-bold no-underline";

/** Mobile-only bottom tab bar: the four most used sections plus "Más", which opens the full menu. */
export function MobileTabBar({ pathname, menuOpen, onOpenMenu }: { pathname: string; menuOpen: boolean; onOpenMenu: () => void }) {
  return (
    <nav aria-label="Navegación rápida" className="fixed inset-x-0 bottom-0 z-[30] flex border-t border-line bg-white pb-[env(safe-area-inset-bottom)] desk:hidden">
      {TABS.map(({ key, label, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link key={key} href={href} aria-current={active ? "page" : undefined} className={cn(ITEM, active ? "text-royal" : "text-muted")}>
            <Icon aria-hidden className="size-6" />
            {label}
          </Link>
        );
      })}
      <button type="button" onClick={onOpenMenu} aria-label="Más secciones" aria-expanded={menuOpen} aria-controls="app-menu-sheet" className={cn(ITEM, "cursor-pointer border-0 bg-transparent", menuOpen ? "text-royal" : "text-muted")}>
        <Menu aria-hidden className="size-6" />
        Más
      </button>
    </nav>
  );
}
