"use client";

import { LogIn, Menu, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { buttonClasses } from "@/components/ui";
import type { SiteNavItem } from "./nav";

/** Public header menu on mobile (< desk): "Menú" button and a sheet under the header. Escape closes. */
export function MobileMenu({ items, primary, hasSession }: { items: readonly SiteNavItem[]; primary: SiteNavItem; hasSession: boolean }) {
  const [open, setOpen] = useState(false);
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
          {hasSession ? null : (
            <Link href="/login" onClick={close} className="flex min-h-14 items-center gap-3 font-bold text-ink no-underline">
              <LogIn aria-hidden className="size-5" />
              Ingresar
            </Link>
          )}
          <Link href={primary.href} onClick={close} className={buttonClasses("accent", "mt-2 min-h-14", "lg")}>{primary.label}</Link>
        </nav>
      ) : null}
    </>
  );
}
