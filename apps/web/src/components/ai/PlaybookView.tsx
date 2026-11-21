"use client";

import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import {
  CLOSING_STYLES,
  PLAYBOOK_MAX_OBJECTIONS,
  PLAYBOOK_FOLLOW_UP_MAX_COUNT,
  PLAYBOOK_FOLLOW_UP_MAX_DELAY_HOURS,
  PLAYBOOK_OBJECTION_RESPONSE_MAX_CHARS,
  PLAYBOOK_OBJECTION_TRIGGER_MAX_CHARS,
  PLAYBOOK_STAGE_MAX_CHARS,
  SALES_STAGES,
  type PlaybookConfig,
  type PlaybookObjection,
} from "@crmwsp/contracts";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, Input, Label, Notice, OptionCard, Spinner, Switch, Textarea, Toast } from "@/components/ui";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { CLOSING_LABELS, STAGE_HINTS, STAGE_LABELS, newObjectionId } from "@/lib/playbook";
import { playbookApi } from "@/lib/playbook-api";
import { AiSectionTabs } from "./AiSectionTabs";

const clampInt = (raw: string, min: number, max: number, fallback: number): number => {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function Form({ initial, onSaved }: { initial: PlaybookConfig; onSaved: (c: PlaybookConfig) => void }) {
  const [cfg, setCfg] = useState<PlaybookConfig>(initial);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const { message, show } = useToast();

  const patchObjection = (id: string, patch: Partial<PlaybookObjection>) =>
    setCfg((c) => ({ ...c, objections: c.objections.map((o) => (o.id === id ? { ...o, ...patch } : o)) }));

  function addObjection() {
    setCfg((c) => {
      if (c.objections.length >= PLAYBOOK_MAX_OBJECTIONS) return c;
      const id = newObjectionId("nueva objeción", c.objections.map((o) => o.id));
      return { ...c, objections: [...c.objections, { id, trigger: "", response: "" }] };
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (cfg.objections.some((o) => !o.trigger.trim() || !o.response.trim())) {
      return setError("Cada objeción necesita una descripción y una respuesta aprobada.");
    }
    setBusy(true);
    setError(undefined);
    try {
      // Ids stay stable once saved; only blank-trigger placeholders are re-derived from the text.
      const taken: string[] = [];
      const objections = cfg.objections.map((o) => {
        const id = /^nueva-objecion(-\d+)?$/.test(o.id) ? newObjectionId(o.trigger, taken) : o.id;
        taken.push(id);
        return { ...o, id };
      });
      const saved = await playbookApi.save({ ...cfg, objections });
      onSaved(saved);
      setCfg(saved);
      show("Playbook guardado");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-[980px] flex-col gap-4" noValidate>
      <Card className="sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-[19px]">Guion de ventas</h2>
            <p className="mt-1 mb-0 text-sm text-ink-3">
              Técnicas de venta honestas para tu IA: escuchar, recomendar, resolver dudas y cerrar sin presionar. La IA nunca engaña, no inventa escasez ni urgencia y no se hace pasar por una persona.
            </p>
          </div>
          <Switch checked={cfg.enabled} onChange={(enabled) => setCfg((c) => ({ ...c, enabled }))} label="Activar playbook de ventas" />
        </div>
        <div className="mt-3">
          <Notice>El playbook solo guía el tono y el orden. Los precios, el stock y los plazos siguen saliendo únicamente de Conocimiento; si no hay una fuente, la IA deriva a una persona.</Notice>
        </div>
      </Card>

      <Card className="sm:p-6">
        <h2 className="m-0 text-[19px]">Etapas del embudo</h2>
        <p className="mt-1 mb-4 text-sm text-ink-3">La IA detecta en qué etapa está cada conversación y aplica solo la indicación de esa etapa.</p>
        <div className="flex flex-col gap-4">
          {SALES_STAGES.map((stage) => (
            <div key={stage} className="flex flex-col gap-1.5">
              <Label htmlFor={`stage-${stage}`}>{STAGE_LABELS[stage]}</Label>
              <Textarea
                id={`stage-${stage}`}
                rows={3}
                maxLength={PLAYBOOK_STAGE_MAX_CHARS}
                value={cfg.stages[stage]}
                onChange={(e) => setCfg((c) => ({ ...c, stages: { ...c.stages, [stage]: e.target.value } }))}
              />
              <span className="text-xs text-muted">{STAGE_HINTS[stage]}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="sm:p-6">
        <h2 className="m-0 text-[19px]">Biblioteca de objeciones</h2>
        <p className="mt-1 mb-4 text-sm text-ink-3">
          Describe lo que dice el cliente y cómo quieres que responda la IA. En cada mensaje solo se le muestran las objeciones que encajan con lo que escribió el cliente.
        </p>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {cfg.objections.map((o, i) => (
            <li key={o.id} className="flex flex-col gap-2 rounded-[14px] border border-line p-3">
              <div className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={`obj-trigger-${o.id}`}>Cuando el cliente… (objeción {i + 1})</Label>
                  <Input
                    id={`obj-trigger-${o.id}`}
                    maxLength={PLAYBOOK_OBJECTION_TRIGGER_MAX_CHARS}
                    value={o.trigger}
                    placeholder="Dice que es caro o pide descuento"
                    onChange={(e) => patchObjection(o.id, { trigger: e.target.value })}
                  />
                </div>
                <Button type="button" variant="outline" aria-label={`Quitar la objeción ${i + 1}`} onClick={() => setCfg((c) => ({ ...c, objections: c.objections.filter((x) => x.id !== o.id) }))}>
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`obj-response-${o.id}`}>Respuesta aprobada</Label>
                <Textarea
                  id={`obj-response-${o.id}`}
                  rows={3}
                  maxLength={PLAYBOOK_OBJECTION_RESPONSE_MAX_CHARS}
                  value={o.response}
                  onChange={(e) => patchObjection(o.id, { response: e.target.value })}
                />
              </div>
            </li>
          ))}
        </ul>
        {cfg.objections.length === 0 ? <p className="mt-0 mb-3 text-sm text-muted">Sin objeciones: la IA responderá solo con la indicación de la etapa.</p> : null}
        <div className="mt-3">
          <Button type="button" variant="outline" disabled={cfg.objections.length >= PLAYBOOK_MAX_OBJECTIONS} onClick={addObjection}>
            <Plus aria-hidden className="size-4" /> Añadir objeción
          </Button>
        </div>
      </Card>

      <Card className="sm:p-6">
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-[19px] font-bold">Estilo de cierre</legend>
          <div role="radiogroup" className="grid gap-3 sm:grid-cols-2">
            {CLOSING_STYLES.map((s) => (
              <OptionCard key={s} mode="radio" selected={cfg.closingStyle === s} onSelect={() => setCfg((c) => ({ ...c, closingStyle: s }))}>
                <b className="block">{CLOSING_LABELS[s].title}</b>
                <span className="text-sm text-ink-3">{CLOSING_LABELS[s].hint}</span>
              </OptionCard>
            ))}
          </div>
        </fieldset>
      </Card>

      <Card className="sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-[19px]">Seguimiento</h2>
            <p className="mt-1 mb-0 text-sm text-ink-3">
              Preferencias para retomar conversaciones que se enfrían. WhatsApp solo permite texto libre durante las 24 h posteriores al último mensaje del cliente, por eso el plazo máximo es de {PLAYBOOK_FOLLOW_UP_MAX_DELAY_HOURS} h.
            </p>
          </div>
          <Switch checked={cfg.followUp.enabled} onChange={(enabled) => setCfg((c) => ({ ...c, followUp: { ...c.followUp, enabled } }))} label="Activar seguimiento" />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pb-delay">Esperar (horas)</Label>
            <Input
              id="pb-delay"
              type="number"
              inputMode="numeric"
              min={1}
              max={PLAYBOOK_FOLLOW_UP_MAX_DELAY_HOURS}
              value={cfg.followUp.delayHours}
              onChange={(e) => setCfg((c) => ({ ...c, followUp: { ...c.followUp, delayHours: clampInt(e.target.value, 1, PLAYBOOK_FOLLOW_UP_MAX_DELAY_HOURS, c.followUp.delayHours) } }))}
            />
            <span className="text-xs text-muted">Tiempo sin respuesta del cliente antes de retomar (1 a {PLAYBOOK_FOLLOW_UP_MAX_DELAY_HOURS}).</span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pb-max">Máximo de seguimientos</Label>
            <Input
              id="pb-max"
              type="number"
              inputMode="numeric"
              min={1}
              max={PLAYBOOK_FOLLOW_UP_MAX_COUNT}
              value={cfg.followUp.maxFollowUps}
              onChange={(e) => setCfg((c) => ({ ...c, followUp: { ...c.followUp, maxFollowUps: clampInt(e.target.value, 1, PLAYBOOK_FOLLOW_UP_MAX_COUNT, c.followUp.maxFollowUps) } }))}
            />
            <span className="text-xs text-muted">Por conversación (1 a {PLAYBOOK_FOLLOW_UP_MAX_COUNT}).</span>
          </div>
        </div>
        <div className="mt-3">
          <Notice>Estas preferencias ya se guardan, pero el envío automático de seguimientos del playbook todavía no está conectado. Mientras tanto, la regla «Lead detenido» de seguimientos sigue funcionando por separado.</Notice>
        </div>
      </Card>

      <Alert>{error}</Alert>
      <div>
        <Button type="submit" variant="accent" disabled={busy}>
          {busy ? <Spinner /> : null}Guardar playbook
        </Button>
      </div>
      <Toast message={message} />
    </form>
  );
}

function Body() {
  const [initial, setInitial] = useState<PlaybookConfig | null>(null);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    playbookApi
      .get()
      .then((p) => live && setInitial(p))
      .catch((err: unknown) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!initial) return <p className="text-muted" aria-busy="true">Cargando playbook…</p>;
  return <Form initial={initial} onSaved={setInitial} />;
}

export function PlaybookView() {
  const { tenant } = useSession();
  return (
    <>
      <PageHeader title="IA" subtitle="Enseña a tu IA a vender con honestidad: etapas, objeciones, cierre y seguimiento." />
      <AiSectionTabs />
      {canManageAi(tenant?.role) ? <Body /> : <EmptyState title="Sin acceso">Pide a un propietario o administrador que gestione el playbook de ventas.</EmptyState>}
    </>
  );
}
