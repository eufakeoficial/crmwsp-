"use client";

import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui";
import { getConsentSnapshot, getServerConsentSnapshot, subscribeConsent, writeConsent } from "@/lib/consent";

/** Cookie notice. Hidden on the server and until the stored choice is read, so it never flashes. */
export function ConsentBanner() {
  const consent = useSyncExternalStore(subscribeConsent, getConsentSnapshot, getServerConsentSnapshot);
  if (consent !== "unset") return null;
  return (
    <section
      aria-label="Aviso de cookies"
      className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 text-sm text-ink shadow-lg sm:left-auto sm:max-w-md"
    >
      <p className="m-0">
        Usamos cookies para medir el uso del sitio y mejorar nuestra publicidad. Solo se activan si las aceptas.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => writeConsent("accepted")}>Aceptar</Button>
        <Button size="sm" variant="outline" onClick={() => writeConsent("rejected")}>Rechazar</Button>
      </div>
    </section>
  );
}
