"use client";

import type { TenantStatus } from "@crmwsp/contracts";
import type React from "react";
import { type DependencyList, type ReactNode, useEffect, useRef, useState } from "react";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { TENANT_STATUS_LABELS, platformErrorMessage } from "@/lib/platform-api";

const STATUS_CLASSES: Record<TenantStatus, string> = {
  active: "bg-lime-soft text-ink",
  pending_approval: "bg-amber-soft text-amber-ink",
  rejected: "bg-paper text-muted",
  suspended: "bg-danger-soft text-danger",
};

export function StatusPill({ status }: { status: TenantStatus }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap", STATUS_CLASSES[status])}>
      {TENANT_STATUS_LABELS[status]}
    </span>
  );
}

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** Loads `fn` on mount and whenever `deps` change; `reload()` refetches. */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current().then(
      (d) => {
        if (!alive) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!alive) return;
        setError(platformErrorMessage(err));
        setLoading(false);
      },
    );
    return () => {
      alive = false;
    };
  }, [...deps, tick]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}

export function Loading({ state, children }: { state: AsyncState<unknown>; children: ReactNode }) {
  if (state.error) return <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger" role="alert">{state.error}</p>;
  if (state.loading && state.data === null) {
    return (
      <div className="flex justify-center py-10" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * Compact table shell. Desktop: horizontal scroll inside the card, never the page.
 * Phones (below `desk`): each row becomes a stacked card; the header labels are
 * exposed as CSS variables and rendered above each cell via ::before.
 */
// Class names are written out in full on purpose: Tailwind only generates classes it finds as literal strings.
const CARD_LABEL_CLASSES =
  "max-desk:[&_td:nth-child(1)]:before:content-[var(--l1)] max-desk:[&_td:nth-child(2)]:before:content-[var(--l2)] max-desk:[&_td:nth-child(3)]:before:content-[var(--l3)] max-desk:[&_td:nth-child(4)]:before:content-[var(--l4)] max-desk:[&_td:nth-child(5)]:before:content-[var(--l5)] max-desk:[&_td:nth-child(6)]:before:content-[var(--l6)] max-desk:[&_td:nth-child(7)]:before:content-[var(--l7)] max-desk:[&_td:nth-child(8)]:before:content-[var(--l8)]";
const CARD_CLASSES = [
  "max-desk:block max-desk:min-w-0",
  "max-desk:[&_thead]:hidden max-desk:[&_tbody]:block max-desk:[&_tr]:block",
  "max-desk:[&_tbody_tr]:border-b max-desk:[&_tbody_tr]:border-line max-desk:[&_tbody_tr]:py-1.5",
  "max-desk:[&_td]:block max-desk:[&_td]:min-w-0 max-desk:[&_td]:border-0 max-desk:[&_td]:break-words max-desk:[&_td]:whitespace-normal",
  "max-desk:[&_td]:before:mb-0.5 max-desk:[&_td]:before:block max-desk:[&_td]:before:text-[11px] max-desk:[&_td]:before:font-extrabold max-desk:[&_td]:before:text-muted max-desk:[&_td]:before:uppercase",
  CARD_LABEL_CLASSES,
].join(" ");

export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  const labels = Object.fromEntries(head.map((h, i) => [`--l${i + 1}`, JSON.stringify(h)])) as React.CSSProperties;
  return (
    <div className="overflow-x-auto rounded-[16px] bg-white max-desk:overflow-x-hidden">
      <table style={labels} className={`w-full min-w-[640px] border-collapse text-left text-[13px] ${CARD_CLASSES}`}>
        <thead>
          <tr className="border-b border-paper text-[11px] font-extrabold text-muted uppercase">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-extrabold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const td = "px-3 py-2 align-middle border-b border-paper";
export const fieldClass = "h-9 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[13px] text-ink max-desk:h-11 max-desk:min-w-0 max-desk:text-[16px]";
