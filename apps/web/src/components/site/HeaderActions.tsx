"use client";

import { LayoutDashboard, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { buttonClasses, initials } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { SiteNavItem } from "./nav";
import { useSiteUser } from "./site-session";
import { firstName } from "./site-user";

const ITEM = "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-left font-semibold text-ink no-underline hover:bg-paper focus-visible:bg-paper";

/** Desktop header actions: logged-out links first, swapped for a user chip once /auth/me answers 200. */
export function HeaderActions({ hasSession, primary }: { hasSession: boolean; primary: SiteNavItem }) {
  const { user, clear } = useSiteUser();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const logged = hasSession || user !== null;

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = user ? { href: "/app", label: "Ir a mi panel" } : primary;
  const label = user ? firstName(user) : "";

  return (
    <div className="ml-auto hidden items-center gap-2 desk:flex">
      {logged ? null : <Link href="/login" className="flex h-12 items-center px-4 font-bold text-ink no-underline">Ingresar</Link>}
      {user ? (
        <div ref={ref} className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`Menú de usuario: ${label}`}
            data-testid="site-user-chip"
            className="flex h-12 min-w-[104px] cursor-pointer items-center gap-2 rounded-full bg-paper pr-4 pl-1.5 font-bold text-ink hover:bg-line"
          >
            <span aria-hidden className="grid size-9 place-items-center rounded-full bg-royal text-[13px] font-extrabold text-lime">
              {initials(user.name ?? user.email)}
            </span>
            <span className="max-w-[120px] truncate">{label}</span>
          </button>
          {open ? (
            <div role="menu" aria-label="Cuenta" className="absolute top-14 right-0 z-50 flex w-[240px] flex-col gap-0.5 rounded-[20px] bg-white p-2 shadow-[0_16px_40px_rgba(18,18,18,.22)]">
              <div className="min-w-0 border-b border-paper px-2.5 pt-2 pb-3">
                <b className="block truncate text-ink">{user.name ?? user.email}</b>
                {user.name ? <span className="block truncate text-[12px] text-muted">{user.email}</span> : null}
              </div>
              <Link role="menuitem" href="/app" onClick={() => setOpen(false)} className={cn(ITEM, "font-bold")}>
                <LayoutDashboard aria-hidden className="size-[18px]" />
                Ir a mi panel
              </Link>
              <button
                type="button"
                role="menuitem"
                disabled={loggingOut}
                onClick={() => {
                  setLoggingOut(true);
                  void clear();
                }}
                className={cn(ITEM, "mt-1 border-t border-paper font-bold text-danger disabled:opacity-50")}
              >
                <LogOut aria-hidden className="size-[18px]" />
                Cerrar sesión
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <Link href={current.href} className={buttonClasses("accent", "h-12 px-[22px] text-[15px]")}>{current.label}</Link>
    </div>
  );
}
