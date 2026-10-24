"use client";

import { SUPPORT_CANNED_VARIABLES, type SupportCannedResponse } from "@crmwsp/contracts";
import { useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Button, Textarea } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { platformErrorMessage } from "@/lib/platform-api";
import { platformSupportApi } from "@/lib/support-api";
import { Loading, fieldClass, useAsync } from "./shared";

interface Draft {
  id: string | null;
  title: string;
  body: string;
}
const NEW: Draft = { id: null, title: "", body: "" };

/** CRUD of the platform-wide canned replies used in the support inbox. */
export function CannedResponsesPage() {
  const state = useAsync(() => platformSupportApi.canned(), []);
  const [draft, setDraft] = useState<Draft>(NEW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setDraft(NEW);
      state.reload();
    } catch (err) {
      setError(platformErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() =>
      draft.id
        ? platformSupportApi.updateCanned(draft.id, { title: draft.title, body: draft.body })
        : platformSupportApi.createCanned({ title: draft.title, body: draft.body }),
    );
  const remove = (c: SupportCannedResponse) => {
    if (window.confirm(`¿Eliminar "${c.title}"?`)) void run(() => platformSupportApi.deleteCanned(c.id));
  };
  const valid = draft.title.trim().length > 0 && draft.body.trim().length > 0;
  return (
    <>
      <PageHeader title="Respuestas rápidas" subtitle="Plantillas para responder tickets. Se insertan en la caja de respuesta." />
      <div className="grid gap-4 desk:grid-cols-[1fr_minmax(320px,420px)]">
        <div className="rounded-[16px] bg-white p-2">
          <Loading state={state}>
            {(state.data?.items ?? []).length === 0 ? (
              <p className="m-0 p-3 text-sm text-muted">Todavía no hay respuestas rápidas.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {(state.data?.items ?? []).map((c) => (
                  <li key={c.id} className="flex items-start gap-2 rounded-xl px-3 py-2 hover:bg-paper">
                    <div className="min-w-0 flex-1">
                      <b className="text-[14px]">{c.title}</b>
                      <p className="m-0 mt-0.5 line-clamp-2 text-[12px] whitespace-pre-wrap text-muted">{c.body}</p>
                      <span className="text-[11px] text-muted">Actualizada {formatDateTime(c.updatedAt)}</span>
                    </div>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft({ id: c.id, title: c.title, body: c.body })}>
                      Editar
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(c)}>
                      Eliminar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Loading>
        </div>
        <form
          className="flex flex-col gap-2 rounded-[16px] bg-white p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) void save();
          }}
        >
          <h2 className="m-0 text-[16px] font-extrabold">{draft.id ? "Editar respuesta" : "Nueva respuesta"}</h2>
          <input aria-label="Título" placeholder="Título" maxLength={120} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} className={fieldClass} />
          <Textarea aria-label="Texto" rows={6} maxLength={5000} value={draft.body} onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))} placeholder="Hola {{nombre}}, gracias por escribirnos…" />
          <p className="m-0 text-[12px] text-muted">
            Variables: {SUPPORT_CANNED_VARIABLES.map((v) => `{{${v}}}`).join(", ")}
          </p>
          {error ? <p className="m-0 rounded-xl bg-danger-soft p-2 text-sm text-danger" role="alert">{error}</p> : null}
          <div className="flex justify-end gap-2">
            {draft.id ? (
              <Button variant="ghost" onClick={() => setDraft(NEW)}>
                Cancelar
              </Button>
            ) : null}
            <Button type="submit" disabled={!valid || busy}>
              Guardar
            </Button>
          </div>
        </form>
      </div>
    </>
  );
}
