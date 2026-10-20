"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AppMenuSheet } from "./AppMenuSheet";
import { AppSidebar, type NavCounts } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";

/** `/app` shell: floating black sidebar, `paper` top bar and a mobile menu sheet. */
export function AppShell({ children, counts }: { children: ReactNode; counts?: NavCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <a href="#app-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-3 focus:font-bold focus:text-white">
        Saltar al contenido
      </a>
      <AppSidebar {...(counts ? { counts } : {})} />
      <AppTopbar menuOpen={open} onToggleMenu={() => setOpen((v) => !v)} />
      <main id="app-content" tabIndex={-1} className="min-w-0 px-[clamp(12px,3vw,28px)] pt-[68px] pb-24 outline-none desk:pl-[calc(220px+clamp(12px,3vw,28px))]">
        {children}
      </main>
      {open ? <AppMenuSheet onClose={() => setOpen(false)} {...(counts ? { counts } : {})} /> : null}
    </>
  );
}
