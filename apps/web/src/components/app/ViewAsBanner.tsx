"use client";

import { ROLE_LABELS } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Button } from "@/components/ui";

/** Shown while an owner/admin looks at the app as another member. Read-only: writes are refused. */
export function ViewAsBanner() {
  const { viewAs, stopViewAs } = useSession();
  if (!viewAs) return null;
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm"
      data-testid="view-as-banner"
    >
      <span>
        Estás viendo la app como <strong>{viewAs.name}</strong> ({ROLE_LABELS[viewAs.role]}). Es solo lectura: no puedes enviar ni cambiar nada.
      </span>
      <Button size="sm" variant="accent" onClick={stopViewAs}>
        Salir de esta vista
      </Button>
    </div>
  );
}
