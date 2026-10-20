"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Spinner } from "@/components/ui";
import { usePlatformMe } from "./use-platform-me";

/**
 * Renders the backoffice only for platform admins. Everyone else sees a plain "not found" page
 * (the API answers 404 too, so the panel's existence is not disclosed).
 */
export function PlatformGate({ children }: { children: ReactNode }) {
  const isAdmin = usePlatformMe();
  if (isAdmin === null) {
    return (
      <div className="grid min-h-dvh place-items-center" aria-busy="true">
        <Spinner />
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <div>
          <p className="m-0 text-[40px] font-extrabold">404</p>
          <p className="mt-1 text-sm text-muted">Esta página no existe.</p>
          <Link href="/app" className="mt-3 inline-block text-sm font-bold underline">
            Volver al panel
          </Link>
        </div>
      </main>
    );
  }
  return <>{children}</>;
}
