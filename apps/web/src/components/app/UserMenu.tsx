"use client";

import { Check, LogOut, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { initials } from "@/components/ui";
import { usePlatformMe } from "@/components/platform/use-platform-me";
import { cn } from "@/lib/cn";
import { useSession } from "./SessionProvider";

type Placement = "topbar" | "rail";

const ITEM = "flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-left font-semibold text-ink no-underline hover:bg-paper focus-visible:bg-paper";

/** Avatar button with the account menu: identity, admin panel (platform admins), tenant switch and logout. */
/** `tone="lime"`: lime avatar for dark headers (the admin topbar), where the ink one disappears. */
export function UserMenu({ placement = "topbar", tone, className }: { placement?: Placement; tone?: "lime"; className?: string }) {
  const { me, tenant, selectTenant, logout } = useSession();
  const isPlatformAdmin = usePlatformMe();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const label = me.user.name ?? me.user.email;

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>("[role='menuitem']")?.focus();
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (e.key === "Tab") {
        setOpen(false);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)") ?? []);
      if (items.length === 0) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
      items[next]?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className={cn("relative flex-none", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="user-menu"
        aria-label={`Menú de usuario: ${label}`}
        title={label}
        data-testid="user-menu-trigger"
        className={cn(
          "grid size-9 cursor-pointer place-items-center rounded-full text-[13px] font-extrabold",
          placement === "rail" || tone === "lime" ? "bg-lime text-ink hover:opacity-90" : "bg-royal text-lime hover:bg-azure",
          tone === "lime" && "focus-visible:outline-lime",
        )}
      >
        {initials(label)}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id="user-menu"
          role="menu"
          aria-label="Cuenta"
          className={cn(
            "z-50 flex w-[280px] max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[20px] bg-white p-2 shadow-[0_16px_40px_rgba(18,18,18,.22)]",
            placement === "rail" ? "fixed bottom-3 left-[80px]" : "absolute top-11 right-0",
          )}
        >
          <div className="min-w-0 border-b border-paper px-2.5 pt-2 pb-3">
            <b className="block truncate text-ink">{me.user.name ?? me.user.email}</b>
            {me.user.name ? <span className="block truncate text-[12px] text-muted">{me.user.email}</span> : null}
          </div>
          {isPlatformAdmin ? (
            <Link role="menuitem" href="/app/admin" onClick={() => setOpen(false)} className={cn(ITEM, "font-bold")} data-testid="platform-admin-link">
              <ShieldCheck aria-hidden className="size-[18px]" />
              Panel de administración
            </Link>
          ) : null}
          {me.tenants.length > 1 ? (
            <>
              <span className="px-2.5 pt-2 pb-0.5 text-[12px] font-extrabold text-muted">Cambiar de negocio</span>
              {me.tenants.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="menuitem"
                  aria-current={t.id === tenant?.id ? "true" : undefined}
                  onClick={() => {
                    selectTenant(t.id);
                    setOpen(false);
                  }}
                  className={cn(ITEM, t.id === tenant?.id && "bg-lime-soft/60 font-bold")}
                >
                  <span className="flex-1 truncate">{t.name}</span>
                  {t.id === tenant?.id ? <Check aria-hidden className="size-4" /> : null}
                </button>
              ))}
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void logout();
            }}
            className={cn(ITEM, "mt-1 border-t border-paper font-bold text-danger disabled:opacity-50")}
          >
            <LogOut aria-hidden className="size-[18px]" />
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}
