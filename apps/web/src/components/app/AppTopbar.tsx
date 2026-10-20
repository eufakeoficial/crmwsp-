"use client";

import { Menu, Plus } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui";
import { NotificationBell } from "./notifications/NotificationBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { useSession } from "./SessionProvider";

const ROUND = "grid size-12 flex-none place-items-center rounded-full";

/** Fixed 72px top bar on `paper`: company switcher on the left, bell and primary action on the right. */
export function AppTopbar({ menuOpen, onToggleMenu }: { menuOpen: boolean; onToggleMenu: () => void }) {
  const { tenant } = useSession();
  return (
    <header className="fixed inset-x-0 top-0 z-20 flex items-center gap-2 bg-paper px-[clamp(12px,3vw,28px)] py-3 desk:left-[260px]">
      <Avatar name={tenant?.name ?? "?"} round size="lg" className="max-[479px]:hidden" />
      <TenantSwitcher />
      <span aria-hidden className="flex-1" />
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="Menú"
        aria-expanded={menuOpen}
        aria-controls="app-menu-sheet"
        className={`${ROUND} cursor-pointer bg-ink text-white desk:hidden`}
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <NotificationBell triggerClassName="size-12 flex-none bg-white text-ink" />
      <Link href="/app/quotes" className="hidden h-12 items-center gap-2 rounded-full bg-ink px-[18px] text-[15px] font-bold whitespace-nowrap text-white no-underline desk:flex">
        <Plus aria-hidden className="size-5" />
        Nuevo presupuesto
      </Link>
    </header>
  );
}
