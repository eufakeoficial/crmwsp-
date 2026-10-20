"use client";

import type { BroadcastTemplate } from "@crmwsp/contracts";
import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "@/components/ui";
import { broadcastsApi } from "@/lib/broadcasts-api";

/** Fills `{{n}}` with 1-based values (preview only; the server renders the stored body). */
export function previewTemplate(body: string, values: readonly string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => values[Number(n) - 1] || m);
}

/** Approved templates of the conversation's channel, with param inputs and a live preview. */
export function TemplatePicker({
  channelConnectionId,
  onSend,
}: {
  channelConnectionId: string;
  onSend: (templateId: string, params: string[]) => Promise<boolean>;
}) {
  const [templates, setTemplates] = useState<BroadcastTemplate[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [params, setParams] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    let alive = true;
    broadcastsApi
      .templates()
      .then((r) => {
        if (alive) setTemplates(r.items.filter((t) => t.channelConnectionId === channelConnectionId));
      })
      .catch(() => {
        if (alive) setLoadError(true);
      });
    return () => {
      alive = false;
    };
  }, [channelConnectionId]);

  const selected = templates?.find((t) => t.id === selectedId) ?? null;
  const filled = params.map((p) => p.trim());
  const complete = selected !== null && filled.length === selected.placeholders && filled.every((p) => p.length > 0);

  function choose(id: string) {
    setSelectedId(id);
    const t = templates?.find((x) => x.id === id);
    setParams(Array.from({ length: t?.placeholders ?? 0 }, () => ""));
    setSendError(false);
  }

  function submit() {
    if (!selected || !complete || inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setSendError(false);
    void onSend(selected.id, filled).then((ok) => {
      inFlight.current = false;
      setSending(false);
      if (ok) choose("");
      else setSendError(true);
    });
  }

  if (loadError) return <Alert>No se pudieron cargar las plantillas.</Alert>;
  if (templates === null) return <p className="m-0 text-sm text-muted" aria-busy>Cargando plantillas…</p>;
  if (templates.length === 0) return <p className="m-0 text-sm text-muted">No hay plantillas aprobadas para este canal.</p>;

  return (
    <div className="flex flex-col gap-2" aria-label="Enviar plantilla">
      <select
        aria-label="Plantilla aprobada"
        className="h-10 rounded-xl border border-line bg-white px-3 text-sm"
        value={selectedId}
        onChange={(e) => choose(e.target.value)}
      >
        <option value="">Elige una plantilla aprobada…</option>
        {templates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.language})
          </option>
        ))}
      </select>
      {selected ? (
        <>
          {params.map((p, i) => (
            <Input
              key={i}
              aria-label={`Variable {{${i + 1}}}`}
              placeholder={`Valor para {{${i + 1}}}`}
              value={p}
              maxLength={1024}
              onChange={(e) => setParams((prev) => prev.map((v, j) => (j === i ? e.target.value : v)))}
            />
          ))}
          <p aria-live="polite" className="m-0 whitespace-pre-wrap rounded-xl bg-paper p-2 text-sm">
            {previewTemplate(selected.body, filled)}
          </p>
          {sendError ? <Alert>No se pudo enviar la plantilla.</Alert> : null}
          <Button variant="accent" disabled={!complete || sending} aria-busy={sending} onClick={submit} className="self-end">
            <Send aria-hidden className="size-4" /> Enviar plantilla
          </Button>
        </>
      ) : null}
    </div>
  );
}
