"use client";

import { Bell, LogOut, Menu, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { Avatar } from "@/components/ui";
import { useSession } from "@/components/app/SessionProvider";
import { AdminSearch } from "./AdminSearch";
import { ADMIN_BASE } from "./nav";

const DARK_FOCUS = "focus-visible:outline-lime";

/** Fixed 64px black header: menu (mobile), logo, global search, notifications and profile. */
export function AdminTopbar({ drawerOpen, onToggleDrawer, onCloseDrawer }: { drawerOpen: boolean; onToggleDrawer: () => void; onCloseDrawer: () => void }) {
  const { me, logout } = useSession();
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const name = me.user.name ?? me.user.email;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") setProfileOpen(false);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (e.target instanceof Node && !profileRef.current?.contains(e.target)) setProfileOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center gap-2.5 bg-ink px-3.5 text-white">
        <button type="button" onClick={onToggleDrawer} aria-label="Menú" aria-expanded={drawerOpen} aria-controls="admin-nav" className={`grid size-11 cursor-pointer place-items-center rounded-xl bg-ink-2 text-white desk:hidden ${DARK_FOCUS}`}>
          <Menu aria-hidden className="size-5" />
        </button>
        <Link href={ADMIN_BASE} onClick={onCloseDrawer} className={`flex flex-none items-center gap-2 text-white no-underline ${DARK_FOCUS}`}>
          <LogoMark size={36} />
          <b className="whitespace-nowrap">CRMWSP <span className="text-lime">Admin</span></b>
        </Link>
        <button type="button" onClick={() => setSearchOpen(true)} className={`flex h-[42px] min-w-0 flex-none cursor-pointer items-center justify-center gap-2 rounded-full bg-ink-2 text-[14px] text-subtle max-[639px]:ml-auto max-[639px]:size-[42px] max-[639px]:p-0 min-[640px]:max-w-[520px] min-[640px]:flex-1 min-[640px]:justify-start min-[640px]:px-3.5 desk:ml-[100px] ${DARK_FOCUS}`}>
          <Search aria-hidden className="size-[18px] flex-none" />
          <span className="min-w-0 flex-1 truncate text-left max-[639px]:sr-only">Buscar empresa, usuario, canal…</span>
          <span className="hidden rounded-md bg-ink px-2 py-0.5 text-xs font-bold whitespace-nowrap desk:inline">Ctrl + K</span>
        </button>
        <div className="flex flex-none items-center gap-2.5 min-[640px]:ml-auto">
          <button type="button" aria-disabled="true" title="Notificaciones: próximamente" aria-label="Notificaciones" className={`grid size-[42px] place-items-center rounded-full bg-ink-2 text-white ${DARK_FOCUS}`}>
            <Bell aria-hidden className="size-[18px]" />
          </button>
          <div ref={profileRef} className="relative">
            <button type="button" onClick={() => setProfileOpen((v) => !v)} aria-expanded={profileOpen} aria-controls="admin-profile" aria-label="Mi perfil" className={`flex cursor-pointer items-center gap-2 bg-transparent p-0 text-white ${DARK_FOCUS}`}>
              <Avatar name={name} round />
              <b className="hidden max-w-[140px] truncate text-[13px] desk:block">{name}</b>
            </button>
            {profileOpen ? (
              <div id="admin-profile" className="absolute top-[52px] right-0 flex w-[240px] flex-col rounded-[20px] bg-white p-2 text-ink shadow-[0_16px_40px_rgba(18,18,18,.25)]">
                <div className="border-b border-paper px-2.5 pt-2 pb-3">
                  <b className="block truncate">{name}</b>
                  <span className="text-xs text-muted">{me.user.email}</span>
                </div>
                <Link href="/app" className="flex min-h-11 items-center rounded-xl px-2.5 font-semibold text-ink no-underline hover:bg-paper">Ir a mi panel</Link>
                <button type="button" onClick={() => void logout()} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 font-bold text-danger hover:bg-paper">
                  <LogOut aria-hidden className="size-[18px]" />
                  Cerrar sesión
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {searchOpen ? <AdminSearch onClose={() => setSearchOpen(false)} /> : null}
    </>
  );
}
