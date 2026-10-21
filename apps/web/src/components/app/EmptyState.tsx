import { Hammer } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, buttonClasses } from "@/components/ui";

/** Page title (large, tight tracking) with a muted subtitle. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
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
