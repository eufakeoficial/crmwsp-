"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AI_SECTIONS } from "@/components/app/nav-items";
import { chipClasses } from "@/components/ui/Chip";

/** Route-based sub navigation of the IA section (resumen, ejecuciones, necesitan atención). */
export function AiSectionTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="IA" className="no-scrollbar mb-5 flex gap-1.5 overflow-x-auto">
      {AI_SECTIONS.map((s) => (
        <Link key={s.key} href={s.href} aria-current={pathname === s.href ? "page" : undefined} className={chipClasses(pathname === s.href, "no-underline")}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
