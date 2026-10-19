import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`ds-${title}`} className="mb-10">
      <h2 id={`ds-${title}`} className="mb-4 text-[22px] tracking-[-0.02em]">{title}</h2>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function Row({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div>
      {label ? <p className="mb-2 text-xs font-extrabold text-muted">{label}</p> : null}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
