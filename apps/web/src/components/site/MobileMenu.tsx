"use client";

import { LayoutDashboard, LogIn, LogOut, Menu, User, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui";
import type { SiteNavItem } from "./nav";
import { useSiteUser } from "./site-session";
import { firstName } from "./site-user";

/** Public header menu on mobile (< desk): "Menú" button and a sheet under the header. Escape closes. */
export function MobileMenu({ items, primary, hasSession }: { items: readonly SiteNavItem[]; primary: SiteNavItem; hasSession: boolean }) {
  const [open, setOpen] = useState(false);
  const { user, clear } = useSiteUser();
  const logged = hasSession || user !== null;
  const current = user ? { href: "/app", label: "Ir a mi panel" } : primary;
  const close = () => setOpen(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="site-mobile-menu" className="ml-auto flex h-12 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-4 text-[15px] font-bold text-white desk:hidden">
        {open ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
        Menú
      </button>
      {open ? (
        <nav id="site-mobile-menu" aria-label="Menú" className="absolute inset-x-0 top-[72px] flex flex-col border-t border-line bg-white px-4 pt-2 pb-4 shadow-[0_12px_24px_rgba(18,18,18,.08)] desk:hidden">
          {items.map((item) => (
            <Link key={item.href} href={item.href} onClick={close} className="flex min-h-14 items-center border-b border-paper font-bold text-ink no-underline">{item.label}</Link>
          ))}
          {logged ? null : (
            <Link href="/login" onClick={close} className="flex min-h-14 items-center gap-3 font-bold text-ink no-underline">
              <LogIn aria-hidden className="size-5" />
              Ingresar
            </Link>
          )}
          {user ? (
            <div className="flex min-h-14 items-center gap-3 font-bold text-ink" data-testid="site-user-chip-mobile">
              <User aria-hidden className="size-5" />
              <span className="truncate">{firstName(user)}</span>
            </div>
          ) : null}
          <Link href={current.href} onClick={close} className={buttonClasses("accent", "mt-2 min-h-14", "lg")}>
            {user ? <LayoutDashboard aria-hidden className="size-5" /> : null}
            {current.label}
          </Link>
          {user ? (
            <button type="button" onClick={() => void clear()} className="mt-1 flex min-h-14 cursor-pointer items-center gap-3 text-left font-bold text-danger">
              <LogOut aria-hidden className="size-5" />
              Cerrar sesión
            </button>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
