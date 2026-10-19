import { Hammer } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui";

/** Page title (large, tight tracking) with a muted subtitle. */
export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-[clamp(28px,3.2vw,40px)] leading-[1.08] font-extrabold tracking-[-0.03em]">{title}</h1>
      {subtitle ? <p className="mt-1 mb-0 text-muted">{subtitle}</p> : null}
    </div>
  );
}

export function EmptyState({ title, children, soon = false }: { title: string; children?: ReactNode; soon?: boolean }) {
  return (
    <Card className="flex flex-col items-center py-12 text-center">
      {soon ? (
        <span aria-hidden className="mb-3 grid size-14 place-items-center rounded-full bg-lime text-ink">
          <Hammer className="size-6" />
        </span>
      ) : null}
      <p className="m-0 text-lg font-bold">{title}</p>
      {children ? <p className="mt-2 mb-0 max-w-md text-sm text-muted">{children}</p> : null}
    </Card>
  );
}
