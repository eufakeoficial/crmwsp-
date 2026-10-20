"use client";

import { Check, Circle, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSession } from "@/components/app/SessionProvider";
import { Card, buttonClasses } from "@/components/ui";
import {
  type OnboardingProgress,
  EMPTY_PROGRESS,
  buildChecklist,
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
  const done = items.filter((i) => i.done).length;
  if (done === items.length || progress?.dismissed) return null;
  const pct = Math.round((done / items.length) * 100);
  const next = items.find((i) => !i.done);

  function hide() {
    const p = { ...(progress ?? EMPTY_PROGRESS), dismissed: true };
    setProgress(p);
    saveProgress(tenantId, p);
  }

  return (
    <Card className="mb-4 flex flex-col gap-3 p-4 sm:p-5" aria-label="Primeros pasos">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[17px]">Primeros pasos</h2>
          <p className="m-0 mt-0.5 text-[13px] text-muted">{done} de {items.length} completados</p>
        </div>
        <button type="button" aria-label="Ocultar primeros pasos" onClick={hide} className="grid size-8 cursor-pointer place-items-center rounded-full hover:bg-ink/8">
          <X aria-hidden className="size-4" />
        </button>
      </div>
      <div role="progressbar" aria-label="Progreso de configuración" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-lime transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.step}>
            <Link href={i.href} className="flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm no-underline hover:bg-paper">
              {i.done ? <Check aria-hidden className="size-4 flex-none text-success" /> : <Circle aria-hidden className="size-4 flex-none text-muted" />}
              <span className={i.done ? "text-muted line-through" : "font-bold"}>{i.label}</span>
            </Link>
          </li>
        ))}
      </ul>
      {next ? <div><Link href="/app/onboarding" className={buttonClasses("accent", undefined, "sm")}>Continuar configuración</Link></div> : null}
    </Card>
  );
}

export function GettingStartedCard() {
  const { tenant } = useSession();
  if (!tenant) return null;
  return <Card_ key={tenant.id} tenantId={tenant.id} />;
}
