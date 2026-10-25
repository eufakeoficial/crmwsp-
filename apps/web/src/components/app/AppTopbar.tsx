"use client";

import { LifeBuoy, Menu, Plus } from "lucide-react";
import Link from "next/link";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { NotificationBell } from "./notifications/NotificationBell";
import { TenantSwitcher } from "./TenantSwitcher";
import { UserMenu } from "./UserMenu";
import { useSession } from "./SessionProvider";

const ROUND = "grid size-9 flex-none place-items-center rounded-full";

/** Fixed top bar on `paper`: company switcher on the left, bell and primary action on the right. */
export function AppTopbar({ menuOpen, onToggleMenu, hideOnDesktop = false }: { menuOpen: boolean; onToggleMenu: () => void; hideOnDesktop?: boolean }) {
  const { tenant } = useSession();
  return (
    <header className={cn("fixed inset-x-0 top-0 z-20 flex items-center gap-2 bg-paper px-[clamp(12px,3vw,28px)] py-2.5 desk:left-[232px]", hideOnDesktop && "desk:hidden")}>
      <Avatar name={tenant?.name ?? "?"} round size="md" className="max-[479px]:hidden" />
      <TenantSwitcher />
      <span aria-hidden className="flex-1" />
      <button
        type="button"
        onClick={onToggleMenu}
        aria-label="Menú"
        aria-expanded={menuOpen}
        aria-controls="app-menu-sheet"
        className={`${ROUND} cursor-pointer bg-royal text-white desk:hidden`}
      >
        <Menu aria-hidden className="size-5" />
      </button>
      <NotificationBell triggerClassName="size-9 flex-none bg-white text-ink" />
      <Link href="/app/support" aria-label="Soporte" title="Soporte" className={`${ROUND} bg-white text-ink no-underline hover:bg-ink/5`}>
        <LifeBuoy aria-hidden className="size-5" />
      </Link>
      <Link href="/app/quotes" className="hidden h-9 items-center gap-1.5 rounded-full bg-royal px-4 hover:bg-azure text-[13px] font-bold whitespace-nowrap text-white no-underline desk:flex">
        <Plus aria-hidden className="size-5" />
        Nuevo presupuesto
      </Link>
      <UserMenu />
    </header>
  );
}
