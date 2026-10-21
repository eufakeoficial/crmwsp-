"use client";

import { Check, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { Card, buttonClasses } from "@/components/ui";
import {
  type ChecklistStep,
  type OnboardingProgress,
  EMPTY_PROGRESS,
  buildChecklist,
  checklistProgress,
  fetchOnboardingStatus,
  loadProgress,
  saveProgress,
} from "@/lib/onboarding-api";

/** "Primeros pasos" card for the home: progress computed from real data, hidden once complete or dismissed. */
function Card_({ tenantId }: { tenantId: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof fetchOnboardingStatus>>>();
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);

  useEffect(() => {
    setProgress(loadProgress(tenantId));
    void fetchOnboardingStatus().then(setStatus);
  }, [tenantId]);

  if (!status) return null;
  const items = buildChecklist(status, progress);
  const { done, total, complete } = checklistProgress(items);
  if (complete || progress?.dismissed) return null;
  const pct = Math.round((done / total) * 100);
  const next = items.find((i) => !i.done);

  function save(p: OnboardingProgress) {
    setProgress(p);
    saveProgress(tenantId, p);
  }
  function hide() {
    save({ ...(progress ?? EMPTY_PROGRESS), dismissed: true });
  }
  function markDone(step: ChecklistStep) {
    const base = progress ?? EMPTY_PROGRESS;
    save({ ...base, manual: { ...base.manual, [step]: true } });
  }

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4 sm:p-5" aria-label="Primeros pasos">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[17px]">Primeros pasos</h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{done} de {total} completados</p>
        </div>
        <button type="button" aria-label="Ocultar primeros pasos" onClick={hide} className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-ink/8">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div role="progressbar" aria-label="Progreso de configuración" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-lime transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ol className="m-0 grid list-none gap-1 p-0">
        {items.map((i, n) => (
          <li key={i.step} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-2 py-1.5">
            {i.done ? <Check aria-hidden className="size-4 flex-none text-success" /> : <Circle aria-hidden className="size-4 flex-none text-muted" />}
            <div className="min-w-0 flex-1 basis-56">
              <span className={i.done ? "text-sm text-muted line-through" : "text-sm font-bold"}>
                {n + 1}. {i.label}
                {i.optional ? <span className="font-normal text-muted no-underline"> (opcional)</span> : null}
              </span>
              {i.done ? null : <p className="m-0 text-[12px] text-muted">{i.hint}</p>}
            </div>
            {i.done ? null : (
              <div className="flex flex-none items-center gap-2">
                {i.manual ? (
                  <button type="button" onClick={() => markDone(i.step)} className="cursor-pointer border-0 bg-transparent p-0 text-[12px] font-semibold text-muted underline">
                    Ya lo hice
                  </button>
                ) : null}
                <Link href={i.href} className={buttonClasses(i === next ? "accent" : "outline", undefined, "sm")}>{i.cta}</Link>
              </div>
            )}
          </li>
        ))}
      </ol>
      <div><Link href="/app/onboarding" className="text-[13px] font-semibold text-muted underline">Prefiero un asistente paso a paso</Link></div>
    </Card>
  );
}

export function GettingStartedCard() {
  const { tenant } = useSession();
  if (!tenant) return null;
  return <Card_ key={tenant.id} tenantId={tenant.id} />;
}
