"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { chipClasses } from "@/components/ui/Chip";
import { SETTINGS_SECTIONS } from "@/components/app/nav-items";

/** Route-based sub navigation of Configuración: exactly SETTINGS_SECTIONS (it already has Modo dueño). */
export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="Configuración" className="no-scrollbar -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 py-1">
      {SETTINGS_SECTIONS.map((s) => {
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
