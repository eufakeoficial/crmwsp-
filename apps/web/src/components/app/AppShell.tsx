"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AppMenuSheet } from "./AppMenuSheet";
import { cn } from "@/lib/cn";
import { AppSidebar, type NavCounts } from "./AppSidebar";
import { AppTopbar } from "./AppTopbar";
import { isActive } from "./nav-items";

/** `/app` shell: floating black sidebar, `paper` top bar and a mobile menu sheet. */
export function AppShell({ children, counts }: { children: ReactNode; counts?: NavCounts }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  // The inbox is a full-bleed workspace: icon rail, no top bar on desktop, no page padding.
  const inbox = isActive(pathname, "/app/inbox");

  useEffect(() => setOpen(false), [pathname]);

  return (
    <>
      <a href="#app-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[70] focus:rounded-full focus:bg-ink focus:px-4 focus:py-3 focus:font-bold focus:text-white">
        Saltar al contenido
      </a>
      <AppSidebar rail={inbox} {...(counts ? { counts } : {})} />
      <AppTopbar hideOnDesktop={inbox} menuOpen={open} onToggleMenu={() => setOpen((v) => !v)} />
      <main id="app-content" tabIndex={-1} className={cn(
          "min-w-0 outline-none",
          inbox ? "px-0 pt-[68px] pb-0 desk:pt-0 desk:pl-[72px]" : "px-[clamp(12px,3vw,28px)] pt-[68px] pb-24 desk:pl-[calc(220px+clamp(12px,3vw,28px))]",
        )}>
        {children}
      </main>
      {open ? <AppMenuSheet onClose={() => setOpen(false)} {...(counts ? { counts } : {})} /> : null}
    </>
  );
}
