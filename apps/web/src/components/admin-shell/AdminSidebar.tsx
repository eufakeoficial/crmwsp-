"use client";

import { ChevronDown, ChevronUp } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { ADMIN_NAV, type AdminNavGroup, resolveActiveKey } from "./nav";

function NavGroup({ group, open, activeKey, counts, onToggle, onNavigate }: { group: AdminNavGroup; open: boolean; activeKey: string | null; counts: Readonly<Record<string, number>>; onToggle: () => void; onNavigate: () => void }) {
  const listId = `admin-nav-${group.id}`;
  return (
    <div className={cn("flex flex-col gap-px", group.title ? "mt-2" : "mt-0.5")}>
      {group.title ? (
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={listId} className="flex h-[34px] cursor-pointer items-center gap-1.5 bg-transparent px-2.5 text-left text-[11px] font-extrabold tracking-[0.6px] text-muted">
          <span className="flex-1">{group.title}</span>
          {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
        </button>
      ) : null}
      {open ? (
        <ul id={listId} className="m-0 flex list-none flex-col gap-px p-0">
          {group.items.map((item) => {
            const active = item.key === activeKey;
            const count = counts[item.key];
            const Icon = item.icon;
            return (
              <li key={item.key}>
                <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-10 items-center gap-2.5 rounded-xl px-2.5 text-[14px] no-underline", active ? "bg-royal font-extrabold text-white" : "font-semibold text-ink hover:bg-royal-soft")}>
                  <Icon aria-hidden className={cn("size-[17px] flex-none", active ? "text-lime" : "text-muted")} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {count ? (
                    <span className={cn("rounded-full px-[7px] text-xs font-extrabold", active ? "bg-lime text-ink" : "bg-danger-soft text-danger")}>
                      <span className="sr-only">Pendientes: </span>
                      {count}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

/** White sidebar with collapsible sections and counters; a drawer on mobile. */
export function AdminSidebar({ drawerOpen, onClose, counts = {} }: { drawerOpen: boolean; onClose: () => void; counts?: Readonly<Record<string, number>> }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Readonly<Record<string, boolean>>>({});
  const activeKey = resolveActiveKey(pathname);
  return (
    <>
      {drawerOpen ? <div onClick={onClose} aria-hidden className="fixed inset-x-0 top-16 bottom-0 z-[24] bg-ink/40 desk:hidden" /> : null}
      <nav id="admin-nav" aria-label="Menú del backoffice" className={cn("fixed top-16 bottom-0 left-0 z-[25] w-[264px] flex-col gap-0.5 overflow-y-auto overscroll-contain border-r border-line bg-white px-2 pt-2.5 pb-6", drawerOpen ? "flex" : "hidden desk:flex")}>
        {ADMIN_NAV.map((group) => (
          <NavGroup key={group.id} group={group} open={!group.title || !collapsed[group.id]} activeKey={activeKey} counts={counts} onToggle={() => setCollapsed((c) => ({ ...c, [group.id]: !c[group.id] }))} onNavigate={onClose} />
        ))}
      </nav>
    </>
  );
}
