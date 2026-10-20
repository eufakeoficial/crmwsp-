"use client";

import type { TenantStatus } from "@crmwsp/contracts";
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

/** Compact table shell (horizontal scroll inside the card, never the page). */
export function Table({ head, children }: { head: readonly string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[16px] bg-white">
      <table className="w-full min-w-[640px] border-collapse text-left text-[13px]">
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
export const fieldClass = "h-9 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[13px] text-ink";
