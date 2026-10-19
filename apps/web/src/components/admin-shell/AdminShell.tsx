"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AdminSidebar } from "./AdminSidebar";
import { AdminTopbar } from "./AdminTopbar";

/** Backoffice shell: black header with search, white sidebar with collapsible sections. */
export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawerOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  return (
    <>
      <AdminTopbar drawerOpen={drawerOpen} onToggleDrawer={() => setDrawerOpen((v) => !v)} onCloseDrawer={() => setDrawerOpen(false)} />
      <AdminSidebar drawerOpen={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <main className="min-w-0 px-[clamp(12px,3vw,28px)] pt-[88px] pb-16 desk:pl-[calc(264px+clamp(12px,3vw,28px))]">{children}</main>
    </>
  );
}
