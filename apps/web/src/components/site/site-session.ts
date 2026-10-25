"use client";

import { useEffect, useState } from "react";
import { api, setActiveTenantId } from "@/lib/api";
import { storeTenantId } from "@/lib/tenant";
import { type SiteUser, loadSiteUser, resetSiteUser } from "./site-user";

/** Resolves the session client-side after hydration; null until known or when logged out. */
export function useSiteUser(): { user: SiteUser | null; clear: () => Promise<void> } {
  const [user, setUser] = useState<SiteUser | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSiteUser(() => api.me()).then((u) => {
      if (!cancelled) setUser(u);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const clear = async () => {
    try {
      await api.logout();
    } finally {
      setActiveTenantId(null);
      storeTenantId(null);
      resetSiteUser();
      setUser(null);
      window.location.assign("/");
    }
  };
  return { user, clear };
}
