"use client";

import type { ReactNode } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canViewAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsTabs } from "./SettingsTabs";

/** Shared frame of the three settings screens: title, tabs and role gate. */
export function SettingsFrame({ title, subtitle, children }: { title: string; subtitle: string; children: (ctx: { role: string | undefined }) => ReactNode }) {
  const { tenant } = useSession();
  const allowed = canViewAi(tenant?.role);
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <SettingsTabs />
      {allowed ? children({ role: tenant?.role }) : <EmptyState title="Sin acceso">Pide a un propietario o administrador que gestione esta sección.</EmptyState>}
    </>
  );
}
