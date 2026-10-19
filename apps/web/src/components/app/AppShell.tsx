"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import { cx } from "@/components/ui/cx";
import { ROLE_LABELS } from "./roles";
import { useSession } from "./SessionProvider";

const LINKS = [
  { href: "/app/inbox", label: "Inbox" },
  { href: "/app/channels", label: "Canales" },
  { href: "/app/team", label: "Equipo" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { tenant, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

  // Escape closes the mobile menu.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-screen md:flex">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-3 md:hidden dark:border-zinc-800 dark:bg-zinc-900">
        <span className="font-semibold tracking-wide">CRMWSP</span>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls="app-sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cerrar menú" : "Menú"}
        </Button>
      </header>

      <aside
        id="app-sidebar"
        className={cx(
          "flex-col border-b border-zinc-200 bg-white md:sticky md:top-0 md:flex md:h-screen md:w-64 md:shrink-0 md:border-r md:border-b-0",
          "dark:border-zinc-800 dark:bg-zinc-900",
          open ? "flex" : "hidden",
        )}
      >
        <div className="hidden px-5 pt-6 text-lg font-semibold tracking-wide md:block">CRMWSP</div>
        <div className="px-5 py-4">
          <p className="truncate text-sm font-medium" data-testid="active-tenant">
            {tenant?.name ?? "Sin empresa"}
          </p>
          {tenant ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400" data-testid="active-role">
              {ROLE_LABELS[tenant.role]}
            </p>
          ) : null}
        </div>
        <nav aria-label="Principal" className="flex-1 space-y-1 px-3">
          {LINKS.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={cx(
                  "block rounded-md px-3 py-2 text-sm font-medium",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:focus-visible:outline-emerald-400",
                  active
                    ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                    : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
                )}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-4">
          <Button
            variant="secondary"
            className="w-full"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void logout();
            }}
          >
            Cerrar sesión
          </Button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
    </div>
  );
}
