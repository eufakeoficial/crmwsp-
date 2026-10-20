"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { chipClasses } from "@/components/ui/Chip";
import { SETTINGS_SECTIONS } from "@/components/app/nav-items";

/** F9: run the CRM from the owner's WhatsApp. */
const OWNER_MODE_TAB = { key: "settings-owner-mode", label: "Modo dueño", href: "/app/settings/owner-mode" } as const;

/** Route-based sub navigation of Configuración (IA, Conocimiento, Aprobaciones). */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Configuración" className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto">
      {[...SETTINGS_SECTIONS, OWNER_MODE_TAB].map((s) => {
        const active = pathname === s.href;
        return (
          <Link key={s.key} href={s.href} aria-current={active ? "page" : undefined} className={chipClasses(active, "no-underline")}>
            {s.label}
          </Link>
        );
      })}
    </nav>
  );
}
