import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Avatar } from "./Avatar";

export interface LeadField {
  label: string;
  value: ReactNode;
}

/**
 * Highlighted card with a lime border, a header and mini-fields. Generic pattern for
 * leads / quote requests in the pipeline.
 */
export function LeadCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  highlighted = true,
  className,
}: {
  title: string;
  subtitle?: string;
  badge?: ReactNode;
  fields: readonly LeadField[];
  actions?: ReactNode;
  highlighted?: boolean;
  className?: string;
}) {
  return (
    <article className={cn("flex flex-col gap-3.5 rounded-[22px] border-2 bg-white p-[18px]", highlighted ? "border-lime" : "border-line", className)}>
      <header className="flex items-center gap-3">
        <Avatar name={title} tone="ink" />
        <div className="min-w-0 flex-1">
          <h3 className="m-0 truncate text-[16px]">{title}</h3>
          {subtitle ? <p className="m-0 truncate text-sm text-muted">{subtitle}</p> : null}
        </div>
        {badge}
      </header>
      <dl className="m-0 grid grid-cols-2 gap-2">
        {fields.map((f) => (
          <div key={f.label} className="rounded-[14px] bg-paper-2 px-3 py-2">
            <dt className="text-xs text-muted">{f.label}</dt>
            <dd className="m-0 truncate text-[14px] font-bold">{f.value}</dd>
          </div>
        ))}
      </dl>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </article>
  );
}
