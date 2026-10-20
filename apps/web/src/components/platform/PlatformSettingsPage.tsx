"use client";

import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Switch } from "@/components/ui";
import { platformApi, platformErrorMessage } from "@/lib/platform-api";
import { Loading, useAsync } from "./shared";

export function PlatformSettingsPage() {
  const state = useAsync(() => platformApi.settings(), []);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggle = async (next: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await platformApi.updateSettings(next);
      setMsg(next ? "Las nuevas altas quedarán pendientes de aprobación." : "Las nuevas altas se activan al instante.");
      state.reload();
    } catch (err) {
      setMsg(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <PageHeader title="Configuración" subtitle="Ajustes de la plataforma. Cada cambio queda auditado." />
      <Loading state={state}>
        {state.data ? (
          <div className="flex max-w-xl items-start justify-between gap-4 rounded-[16px] bg-white p-4">
            <div>
              <b className="block text-[14px]">Aprobar altas nuevas</b>
              <span className="text-[13px] text-muted">
                Si está activo, las empresas nuevas entran como pendientes: pueden iniciar sesión pero no conectar canales ni usar la IA hasta que las apruebes.
              </span>
              {msg ? <span className="mt-2 block text-[12px]" role="status">{msg}</span> : null}
            </div>
            <div className={busy ? "pointer-events-none opacity-50" : ""}>
              <Switch checked={state.data.requireApproval} onChange={(v) => void toggle(v)} label="Aprobar altas nuevas" />
            </div>
          </div>
        ) : null}
      </Loading>
    </>
  );
}
