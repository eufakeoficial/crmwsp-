"use client";

import { Menu, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppSearch } from "@/components/search/AppSearch";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NotificationBell } from "./notifications/NotificationBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { useSession } from "./SessionProvider";

const ROUND = "grid size-9 flex-none place-items-center rounded-full";

/** Fixed top bar on `paper`: company switcher on the left, bell and primary action on the right. */
export function AppTopbar({ menuOpen, onToggleMenu, hideOnDesktop = false, showMenuButton = true }: { menuOpen: boolean; onToggleMenu: () => void; hideOnDesktop?: boolean; showMenuButton?: boolean }) {
  const { tenant } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <>
    <header className={cn("fixed inset-x-0 top-0 z-20 flex items-center gap-2 bg-paper px-[clamp(12px,3vw,28px)] py-2.5 desk:left-[232px]", hideOnDesktop && "desk:hidden")}>
      <Avatar name={tenant?.name ?? "?"} round size="md" className="max-[479px]:hidden" />
      <TenantSwitcher />
      <span aria-hidden className="flex-1" />
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Buscar"
        aria-haspopup="dialog"
        className="flex h-9 flex-none cursor-pointer items-center justify-center gap-2 rounded-full bg-white text-[13px] text-muted max-[639px]:size-9 min-[640px]:w-[min(280px,30vw)] min-[640px]:justify-start min-[640px]:px-3.5"
      >
        <Search aria-hidden className="size-[18px] flex-none text-ink" />
        <span className="hidden min-w-0 flex-1 truncate text-left min-[640px]:block">Buscar…</span>
        <span aria-hidden className="hidden rounded-md bg-paper px-2 py-0.5 text-xs font-bold whitespace-nowrap desk:inline">Ctrl K</span>
      </button>
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="Menú"
        aria-expanded={menuOpen}
        aria-controls="app-menu-sheet"
        className={cn(ROUND, "cursor-pointer bg-royal text-white desk:hidden", !showMenuButton && "hidden")}
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <NotificationBell triggerClassName="size-9 flex-none bg-white text-ink" />
      <Link href="/app/quotes" className="hidden h-9 items-center gap-1.5 rounded-full bg-royal px-4 hover:bg-azure text-[13px] font-bold whitespace-nowrap text-white no-underline desk:flex">
        <Plus aria-hidden className="size-5" />
        Nuevo presupuesto
      </Link>
      <UserMenu />
    </header>
    {searchOpen ? <AppSearch onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}
