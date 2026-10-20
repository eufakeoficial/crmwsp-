"use client";

import { type InboxSettings, inboxSettingsSchema } from "@crmwsp/contracts";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Switch } from "@/components/ui";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";
import { errorMessage } from "@/lib/messages";
import { inboxV2Api } from "@/lib/inbox-v2-api";

const FIELD = "h-10 w-full rounded-xl border-[1.5px] border-line-2 bg-white px-3 text-[14px] text-ink disabled:opacity-50";

/** Inbox settings (owner/admin): auto assignment, visibility, reopening and automation pause. */
export function InboxSettingsDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const titleId = useId();
  useDialogBehavior(ref, onClose);
  const [settings, setSettings] = useState<InboxSettings | null>(null);
  const [maxText, setMaxText] = useState("");
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    inboxV2Api.settings().then(
      (s) => {
        if (cancelled) return;
        setSettings(s);
        setMaxText(s.maxOpenPerAgent === null ? "" : String(s.maxOpenPerAgent));
      },
      (err) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (patch: Partial<InboxSettings>) => setSettings((s) => (s ? { ...s, ...patch } : s));

  async function save() {
    if (!settings) return;
    const max = maxText.trim() === "" ? null : Number(maxText);
    const parsed = inboxSettingsSchema.safeParse({ ...settings, maxOpenPerAgent: max });
    if (!parsed.success) {
      setError("Revisa los valores: el máximo por agente va de 1 a 1000 y la pausa de 0 a 10080 minutos.");
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await inboxV2Api.patchSettings(parsed.data);
      onSaved();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 z-40 bg-ink/30" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed top-3 right-3 bottom-3 z-[41] flex w-[min(440px,calc(100vw-24px))] flex-col overflow-hidden rounded-3xl bg-white shadow-[0_20px_60px_rgba(18,18,18,.3)]">
        <div className="flex items-center gap-2.5 border-b border-line p-4">
          <b id={titleId} className="flex-1 text-[17px]">Ajustes de la bandeja</b>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-10 cursor-pointer place-items-center rounded-full bg-paper text-ink">
            <X aria-hidden className="size-[18px]" />
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <Alert>{error}</Alert>
          {settings ? (
            <>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Asignación automática
                <select className={FIELD} value={settings.autoAssign} onChange={(e) => set({ autoAssign: e.target.value as InboxSettings["autoAssign"] })}>
                  <option value="off">Desactivada</option>
                  <option value="round_robin">Rotativa (round robin)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Máximo de chats abiertos por agente
                <input
                  className={FIELD}
                  type="number"
                  min={1}
                  max={1000}
                  inputMode="numeric"
                  placeholder="Sin límite"
                  disabled={settings.autoAssign === "off"}
                  value={maxText}
                  onChange={(e) => setMaxText(e.target.value)}
                />
                <span className="text-xs font-normal text-muted">La rotación salta a los agentes que llegaron al máximo. Vacío = sin límite.</span>
              </label>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Visibilidad
                <select className={FIELD} value={settings.visibility} onChange={(e) => set({ visibility: e.target.value as InboxSettings["visibility"] })}>
                  <option value="all">Todos ven todos los chats</option>
                  <option value="own">Cada agente ve los suyos y los sin asignar</option>
                </select>
              </label>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-bold">
                  Reabrir al recibir un mensaje
                  <span className="block text-xs font-normal text-muted">Un chat cerrado vuelve a Abiertos cuando el contacto escribe.</span>
                </span>
                <Switch label="Reabrir al recibir un mensaje" checked={settings.reopenOnInbound} onChange={(v) => set({ reopenOnInbound: v })} />
              </div>
              <label className="flex flex-col gap-1 text-sm font-bold">
                Pausar la IA tras una respuesta humana (minutos)
                <input
                  className={FIELD}
                  type="number"
                  min={0}
                  max={10080}
                  inputMode="numeric"
                  value={settings.pauseAutomationOnAgentReplyMinutes}
                  onChange={(e) => set({ pauseAutomationOnAgentReplyMinutes: Number(e.target.value) })}
                />
                <span className="text-xs font-normal text-muted">0 = nunca pausar.</span>
              </label>
            </>
          ) : error ? null : (
            <p className="m-0 text-sm text-muted" aria-busy="true">Cargando…</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button variant="accent" disabled={!settings || saving} onClick={() => void save()}>{saving ? "Guardando…" : "Guardar"}</Button>
        </div>
      </aside>
    </>
  );
}
