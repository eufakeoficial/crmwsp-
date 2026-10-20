"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { botTemplatesApi } from "@/lib/bot-templates-api";
import { errorMessage } from "@/lib/messages";
import type { BotTemplate } from "@crmwsp/contracts";
import { SettingsFrame } from "./AccessGate";

function TemplateCard({ t, canEdit }: { t: BotTemplate; canEdit: boolean }) {
  const router = useRouter();
  const [preview, setPreview] = useState(false);
  const [needsOverwrite, setNeedsOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function use(overwrite: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      await botTemplatesApi.apply(t.id, overwrite);
      router.push("/app/settings/ai");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite) setNeedsOverwrite(true);
      else setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="m-0 text-[17px]">{t.name}</h2>
        <p className="m-0 mt-1 text-sm text-ink-3">{t.description}</p>
      </div>
      <button type="button" onClick={() => setPreview((v) => !v)} aria-expanded={preview} className="self-start text-sm underline">
        {preview ? "Ocultar vista previa" : "Ver vista previa"}
      </button>
      {preview ? (
        <div className="flex flex-col gap-2 text-sm">
          <p className="m-0 whitespace-pre-wrap">{t.prompt}</p>
          <b>Respuestas rápidas</b>
          <ul className="m-0 pl-5">{t.quickReplies.map((q) => <li key={q}>{q}</li>)}</ul>
          <b>Seguimientos</b>
          <ul className="m-0 pl-5">{t.followUps.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      ) : null}
      {needsOverwrite ? <Alert>Tu agente ya tiene un prompt. Usar esta plantilla lo reemplazará (queda en el historial de versiones).</Alert> : null}
      <Alert>{error}</Alert>
      {canEdit ? (
        <div>
          {needsOverwrite ? (
            <Button type="button" variant="accent" disabled={busy} onClick={() => void use(true)}>{busy ? <Spinner /> : null}Reemplazar y usar</Button>
          ) : (
            <Button type="button" variant="accent" disabled={busy} onClick={() => void use(false)}>{busy ? <Spinner /> : null}Usar plantilla</Button>
          )}
        </div>
      ) : null}
    </Card>
  );
}

function Body({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<BotTemplate[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    botTemplatesApi.list().then(setItems, (err: unknown) => setError(errorMessage(err)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <p className="text-muted" aria-busy="true">Cargando plantillas…</p>;
  return <div className="grid max-w-[980px] gap-4 sm:grid-cols-2">{items.map((t) => <TemplateCard key={t.id} t={t} canEdit={canEdit} />)}</div>;
}

export function BotTemplatesView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Configuración" subtitle="Elige una plantilla de bot de ventas y edítala en la configuración de IA.">
      {() => <Body canEdit={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}
