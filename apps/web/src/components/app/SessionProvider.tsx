"use client";

import type { MeResponse, UserTenant } from "@crmwsp/contracts";
import { useRouter } from "next/navigation";
import { type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { ApiError, api, setActiveTenantId } from "@/lib/api";
import { errorMessage } from "@/lib/messages";
import { readStoredTenantId, resolveActiveTenant, storeTenantId } from "@/lib/tenant";

interface SessionValue {
  me: MeResponse;
  tenant: UserTenant | null;
  selectTenant: (id: string) => void;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error("useSession must be used inside SessionProvider");
  return value;
}

/**
 * Loads GET /auth/me (401 -> /login), validates the stored tenant against
 * me.tenants and exposes the session. With requireTenant, users with several
 * tenants and no valid choice are sent to /select-tenant.
 */
export function SessionProvider({ children, requireTenant = true }: { children: ReactNode; requireTenant?: boolean }) {
  const router = useRouter();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [tenant, setTenant] = useState<UserTenant | null>(null);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    api
      .me()
      .then((data) => {
        if (cancelled) return;
        const active = resolveActiveTenant(data.tenants, readStoredTenantId());
        setActiveTenantId(active?.id ?? null);
        storeTenantId(active?.id ?? null);
        if (requireTenant && !active && data.tenants.length > 1) {
          router.replace("/select-tenant");
          return;
        }
        setTenant(active);
        setMe(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        setError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [router, requireTenant, attempt]);

  const selectTenant = useCallback(
    (id: string) => {
      const next = me?.tenants.find((t) => t.id === id);
      if (!next) return;
      setActiveTenantId(next.id);
      storeTenantId(next.id);
      setTenant(next);
    },
    [me],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setActiveTenantId(null);
      storeTenantId(null);
      router.replace("/login");
    }
  }, [router]);

  const value = useMemo(() => (me ? { me, tenant, selectTenant, logout } : null), [me, tenant, selectTenant, logout]);

  if (error) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-4">
        <Alert>{error}</Alert>
        <Button onClick={() => setAttempt((n) => n + 1)}>Reintentar</Button>
      </main>
    );
  }
  if (!value) {
    return (
      <main className="flex min-h-screen items-center justify-center" aria-busy="true">
        <p className="text-sm text-muted">Cargando…</p>
      </main>
    );
  }
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
