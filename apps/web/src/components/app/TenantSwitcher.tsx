"use client";

import { Check, ChevronDown, LogOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";
import { ROLE_LABELS } from "./roles";
import { useSession } from "./SessionProvider";

/** White pill with the active company and a lime chevron button; opens the company list and logout. */
export function TenantSwitcher() {
  const { me, tenant, selectTenant, logout } = useSession();
  const [open, setOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative min-w-0 max-w-[calc(100%-180px)]">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="tenant-menu"
        className="flex h-9 w-full max-w-full cursor-pointer items-center gap-2 rounded-full bg-white pr-2 pl-3 text-[13px] font-bold text-ink"
      >
        <span className="sr-only">Empresa activa: </span>
        <span className="truncate" data-testid="active-tenant">{tenant?.name ?? "Sin empresa"}</span>
        <span className="grid size-8 flex-none place-items-center rounded-full bg-lime">
          <ChevronDown aria-hidden className="size-4" />
        </span>
      </button>
      {open ? (
        <div id="tenant-menu" className="absolute top-11 left-0 z-50 flex w-[280px] max-w-[calc(100vw-24px)] flex-col gap-0.5 rounded-[20px] bg-white p-2 shadow-[0_16px_40px_rgba(18,18,18,.22)]">
          <div className="flex items-center gap-2.5 border-b border-paper px-2.5 pt-2 pb-3">
            <Avatar name={me.user.name ?? me.user.email} round size="lg" />
            <span className="min-w-0">
              <b className="block truncate">{me.user.name ?? me.user.email}</b>
              {tenant ? <span className="text-[12px] text-muted" data-testid="active-role">{ROLE_LABELS[tenant.role]}</span> : null}
            </span>
          </div>
          {me.tenants.length > 1 ? <span className="px-2.5 pt-2 pb-0.5 text-[12px] font-extrabold text-muted">Cambiar de empresa</span> : null}
          {me.tenants.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-current={t.id === tenant?.id ? "true" : undefined}
              onClick={() => {
                selectTenant(t.id);
                setOpen(false);
              }}
              className={cn("flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 text-left", t.id === tenant?.id ? "bg-lime-soft/60 font-bold" : "font-semibold hover:bg-paper")}
            >
              <Avatar name={t.name} size="sm" tone={t.id === tenant?.id ? "soft" : "paper"} />
              <span className="flex-1 truncate">{t.name}</span>
              {t.id === tenant?.id ? <Check aria-hidden className="size-4" /> : null}
            </button>
          ))}
          <button
            type="button"
            disabled={loggingOut}
            onClick={() => {
              setLoggingOut(true);
              void logout();
            }}
            className="mt-1 flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl border-t border-paper px-2.5 font-bold text-danger hover:bg-paper disabled:opacity-50"
          >
            <LogOut aria-hidden className="size-[18px]" />
            Cerrar sesión
          </button>
        </div>
      ) : null}
    </div>
  );
}
