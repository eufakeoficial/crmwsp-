"use client";

import { Menu, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { UserMenu } from "@/components/app/UserMenu";
import { AdminSearch } from "./AdminSearch";
import { ADMIN_BASE } from "./nav";

const DARK_FOCUS = "focus-visible:outline-lime";

/** Fixed 64px black header: menu (mobile), logo, global search and profile. */
export function AdminTopbar({ drawerOpen, onToggleDrawer, onCloseDrawer }: { drawerOpen: boolean; onToggleDrawer: () => void; onCloseDrawer: () => void }) {
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
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-2.5 bg-brand-navy px-3.5 text-white">
        <button type="button" onClick={onToggleDrawer} aria-label="Menú" aria-expanded={drawerOpen} aria-controls="admin-nav" className={`grid size-11 cursor-pointer place-items-center rounded-xl bg-white/10 text-white desk:hidden ${DARK_FOCUS}`}>
          <Menu aria-hidden className="size-5" />
        </button>
        <Link href={ADMIN_BASE} onClick={onCloseDrawer} className={`flex flex-none items-center gap-2 text-white no-underline ${DARK_FOCUS}`}>
          <LogoMark size={36} />
          <b className="whitespace-nowrap">CRMWSP <span className="text-lime">Admin</span></b>
        </Link>
        <button type="button" onClick={() => setSearchOpen(true)} className={`flex h-[42px] min-w-0 flex-none cursor-pointer items-center justify-center gap-2 rounded-full bg-white/10 text-[14px] text-subtle max-[639px]:ml-auto max-[639px]:size-[42px] max-[639px]:p-0 min-[640px]:max-w-[520px] min-[640px]:flex-1 min-[640px]:justify-start min-[640px]:px-3.5 desk:ml-[100px] ${DARK_FOCUS}`}>
          <Search aria-hidden className="size-[18px] flex-none" />
          <span className="min-w-0 flex-1 truncate text-left max-[639px]:sr-only">Buscar empresa, usuario, canal…</span>
          <span className="hidden rounded-md bg-navy/60 px-2 py-0.5 text-xs font-bold whitespace-nowrap desk:inline">Ctrl + K</span>
        </button>
        <div className="flex flex-none items-center gap-2.5 min-[640px]:ml-auto">
          <Link href="/app" className={`hidden min-h-[42px] items-center rounded-full bg-white/10 px-3.5 text-[13px] font-bold whitespace-nowrap text-white no-underline min-[640px]:flex ${DARK_FOCUS}`}>
            Ir a mi negocio
          </Link>
          <UserMenu tone="lime" />
        </div>
      </header>
      {searchOpen ? <AdminSearch onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}
