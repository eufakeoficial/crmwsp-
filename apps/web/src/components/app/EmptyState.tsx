"use client";

import { ArrowLeft, Hammer } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Card, buttonClasses } from "@/components/ui";

/** Pages the AI hub links to: they get a "back to IA" link so the hub is never a dead end. */
const AI_HUB_PREFIXES = ["/app/ai/", "/app/settings/ai", "/app/settings/knowledge", "/app/settings/approvals", "/app/settings/owner-mode"];

/** Page title (large, tight tracking) with a muted subtitle. `back` overrides the automatic hub link. */
export function PageHeader({ title, subtitle, back }: { title: string; subtitle?: string; back?: { href: string; label: string } | null }) {
  const pathname = usePathname() ?? "";
  const auto = back === undefined && AI_HUB_PREFIXES.some((p) => pathname.startsWith(p)) ? { href: "/app/ai", label: "IA" } : null;
  const link = back ?? auto;
  return (
    <div className="mb-4">
      {link ? (
        <Link href={link.href} className="mb-2 inline-flex items-center gap-1 text-[13px] font-bold text-muted no-underline hover:text-ink">
          <ArrowLeft aria-hidden className="size-4" /> Volver a {link.label}
        </Link>
      ) : null}
      <h1 className="text-[clamp(22px,2.2vw,26px)] leading-[1.08] font-extrabold tracking-[-0.03em]">{title}</h1>
      {subtitle ? <p className="mt-1 mb-0 text-[13px] text-muted">{subtitle}</p> : null}
    </div>
  );
}

/** Empty state: says what to do first; `action` adds a button to the right page. */
export function EmptyState({ title, children, soon = false, action }: { title: string; children?: ReactNode; soon?: boolean; action?: { href: string; label: string } }) {
  return (
    <Card className="flex flex-col items-center py-10 text-center">
      {soon ? (
        <span aria-hidden className="mb-3 grid size-14 place-items-center rounded-full bg-lime text-ink">
          <Hammer className="size-6" />
        </span>
      ) : null}
      <p className="m-0 text-base font-bold">{title}</p>
      {children ? <p className="mt-2 mb-0 max-w-md text-sm text-muted">{children}</p> : null}
      {action ? <Link href={action.href} className={buttonClasses("accent", "mt-4", "sm")}>{action.label}</Link> : null}
    </Card>
  );
}
