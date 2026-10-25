"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, buttonClasses } from "@/components/ui";
import { aiApi } from "@/lib/ai-api";
import type { AgentConfig, AiConnection, AiUsage } from "@crmwsp/contracts";
import { errorMessage } from "@/lib/messages";
import { SettingsFrame } from "./AccessGate";
import { AgentBehavior } from "./AgentBehavior";
import { ConnectionSection } from "./ConnectionSection";
import { VoiceSection } from "./VoiceSection";

const month = () => new Date().toISOString().slice(0, 7);

function Body({ canEdit }: { canEdit: boolean }) {
  const [connection, setConnection] = useState<AiConnection | null | undefined>(undefined);
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      const [c, u, a] = await Promise.all([aiApi.getConnection(), aiApi.usage(month()), aiApi.getAgentConfig()]);
      setConnection(c);
      setUsage(u);
      setAgent(a);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <Alert>{error}</Alert>;
  if (connection === undefined || !agent) return <p className="text-muted" aria-busy="true">Cargando configuración de IA…</p>;
  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      {canEdit ? (
        <div>
          <Link href="/app/settings/ai/simulator" className={buttonClasses("outline")}>Probar la IA</Link>
        </div>
      ) : null}
      <ConnectionSection connection={connection} usage={usage} canEdit={canEdit} onChanged={() => void load()} />
      <AgentBehavior config={agent} currency={connection?.budgetCurrency ?? "EUR"} canEdit={canEdit} onSaved={setAgent} />
      {canEdit ? <VoiceSection canEdit={canEdit} /> : null}
    </div>
  );
}

export function AiSettingsView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Configuración" subtitle="Conecta tu proveedor de IA y decide cómo se comporta tu agente.">
      {() => <Body canEdit={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}
