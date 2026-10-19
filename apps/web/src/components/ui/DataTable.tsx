import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Scrolls only the table card; keyboard users can focus its scroll region. */
export function TableFrame({ label, children, minWidth = 720, className }: { label: string; children: ReactNode; minWidth?: number; className?: string }) {
  return (
    <div role="region" aria-label={label} tabIndex={0} className={cn("min-w-0 overflow-x-auto rounded-[20px] bg-white px-3.5 py-1", className)}>
      <div role="table" aria-label={label} style={{ minWidth }}>
        {children}
      </div>
    </div>
  );
}

/** Grid table. `grid` is a shared `grid-template-columns` for header and rows. */
export function DataTable({
  label,
  grid,
  columns,
  minWidth,
  empty,
  children,
}: {
  label: string;
  grid: string;
  columns: readonly ReactNode[];
  minWidth?: number;
  empty?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <TableFrame label={label} {...(minWidth ? { minWidth } : {})}>
        <div role="row" className="grid items-center gap-2.5 border-b border-line py-2.5 text-xs font-extrabold text-muted" style={{ gridTemplateColumns: grid }}>
          {columns.map((c, i) => (
            <span key={i} role="columnheader" className="min-w-0">
              {c}
            </span>
          ))}
        </div>
        {children}
      </TableFrame>
      {empty}
    </>
  );
}

export function DataRow({ grid, highlighted = false, children }: { grid: string; highlighted?: boolean; children: ReactNode }) {
  return (
    <div
      role="row"
      className={cn("relative grid items-center gap-2.5 border-b border-paper py-[11px] text-[14px]", highlighted ? "bg-lime-soft/60" : "hover:bg-paper-2")}
      style={{ gridTemplateColumns: grid }}
    >
      {children}
    </div>
  );
}

export function DataCell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div role="cell" className={cn("flex min-w-0 items-center gap-2", className)}>
      {children}
    </div>
  );
}
