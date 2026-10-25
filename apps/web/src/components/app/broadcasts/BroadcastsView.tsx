"use client";

import type {
  AudiencePreview,
  Broadcast,
  BroadcastStats,
  BroadcastStatus,
  BroadcastTemplate,
  BroadcastVariableSource,
} from "@crmwsp/contracts";
import { useCallback, useEffect, useState } from "react";
import { SetupRequiredHint, useSetupMode } from "@/components/app/billing/SetupGate";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Button, Card, Input } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { broadcastsApi } from "@/lib/broadcasts-api";
import { formatDateTime } from "@/lib/format";
import { errorMessage } from "@/lib/messages";

const STATUS_LABELS: Record<BroadcastStatus, string> = {
  draft: "Borrador",
  scheduled: "Programada",
  sending: "Enviando",
  completed: "Completada",
  cancelled: "Cancelada",
};

const SOURCE_LABELS: Record<BroadcastVariableSource["source"], string> = {
  contact_name: "Nombre del contacto",
  contact_phone: "Teléfono del contacto",
  contact_field: "Campo del contacto",
  static: "Texto fijo",
};

const splitTags = (s: string): string[] =>
  s
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

function describeError(err: unknown): string {
  if (err instanceof ApiError && err.status === 402) {
    return "Tu plan no incluye suficientes envíos de campañas este mes. Mejora a Pro o reduce la audiencia.";
  }
  return errorMessage(err);
}

function StatsPanel({ id }: { id: string }) {
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  useEffect(() => {
    broadcastsApi.stats(id).then(setStats, () => setStats(null));
  }, [id]);
  if (!stats) return <p className="m-0 text-sm text-muted">Cargando estadísticas…</p>;
  const items: Array<[string, number]> = [
    ["Total", stats.total],
    ["Pendientes", stats.pending],
    ["Enviados", stats.sent],
    ["Entregados", stats.delivered],
    ["Leídos", stats.read],
    ["Fallidos", stats.failed],
    ["Omitidos", stats.skipped],
  ];
  return (
    <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map(([label, n]) => (
        <div key={label} className="rounded-xl border border-line p-3">
          <dt className="text-xs text-muted">{label}</dt>
          <dd className="m-0 text-xl font-bold">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function VariableEditor({
  index,
  value,
  onChange,
}: {
  index: number;
  value: BroadcastVariableSource;
  onChange: (v: BroadcastVariableSource) => void;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <span className="w-16 text-sm font-semibold">{`{{${index + 1}}}`}</span>
      <select
        className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3"
        value={value.source}
        aria-label={`Origen de la variable ${index + 1}`}
        onChange={(e) => {
          const s = e.target.value as BroadcastVariableSource["source"];
          onChange(s === "contact_field" ? { source: s, key: "" } : s === "static" ? { source: s, value: "" } : { source: s });
        }}
      >
        {Object.entries(SOURCE_LABELS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      {value.source === "contact_field" ? (
        <Input placeholder="clave (p. ej. ciudad)" value={value.key} onChange={(e) => onChange({ ...value, key: e.target.value })} />
      ) : null}
      {value.source === "static" ? (
        <Input placeholder="valor" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })} />
      ) : null}
    </div>
  );
}

function CreateWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<BroadcastTemplate[]>([]);
  const [name, setName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [mapping, setMapping] = useState<BroadcastVariableSource[]>([]);
  const [tags, setTags] = useState("");
  const [excludeTags, setExcludeTags] = useState("");
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    broadcastsApi.templates().then((r) => setTemplates(r.items), (e: unknown) => setError(describeError(e)));
  }, []);

  const template = templates.find((t) => t.id === templateId);
  const audience = { tags: splitTags(tags), excludeTags: splitTags(excludeTags) };

  const pickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    setMapping(Array.from({ length: t?.placeholders ?? 0 }, () => ({ source: "contact_name" }) as BroadcastVariableSource));
  };

  const runPreview = async () => {
    setError(null);
    try {
      setPreview(await broadcastsApi.preview(audience));
      setStep(3);
    } catch (e) {
      setError(describeError(e));
    }
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await broadcastsApi.create({ name, templateId, variableMapping: mapping, audience });
      await broadcastsApi.schedule(created.id, scheduledAt ? new Date(scheduledAt).toISOString() : undefined);
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 flex flex-col gap-4">
      <h2 className="m-0 text-lg font-bold">Nueva campaña · paso {step} de 3</h2>
      <Alert>{error}</Alert>
      {step === 1 ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Nombre
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Promo de octubre" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Plantilla aprobada
            <select
              className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3"
              value={templateId}
              onChange={(e) => pickTemplate(e.target.value)}
            >
              <option value="">Elige una plantilla…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
          </label>
          {template ? <p className="m-0 rounded-xl bg-paper p-3 text-sm whitespace-pre-wrap">{template.body}</p> : null}
          {mapping.map((m, i) => (
            <VariableEditor key={i} index={i} value={m} onChange={(v) => setMapping(mapping.map((x, j) => (j === i ? v : x)))} />
          ))}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button disabled={!name.trim() || !templateId} onClick={() => setStep(2)}>
              Siguiente
            </Button>
          </div>
        </>
      ) : null}
      {step === 2 ? (
        <>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Etiquetas requeridas (separadas por comas; vacío = todos)
            <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="vip, madrid" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Excluir etiquetas
            <Input value={excludeTags} onChange={(e) => setExcludeTags(e.target.value)} placeholder="baja-temporal" />
          </label>
          <p className="m-0 text-sm text-muted">Solo se incluyen contactos con consentimiento de marketing; quienes respondieron BAJA o STOP quedan fuera.</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Atrás
            </Button>
            <Button onClick={() => void runPreview()}>Calcular audiencia</Button>
          </div>
        </>
      ) : null}
      {step === 3 && preview ? (
        <>
          <p className="m-0">
            <strong>{preview.count}</strong> destinatarios. {preview.excludedNoConsent} excluidos por no tener consentimiento de marketing.
          </p>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Programar (vacío = enviar ahora)
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Atrás
            </Button>
            <Button disabled={busy || preview.count === 0} onClick={() => void submit()}>
              {scheduledAt ? "Programar campaña" : "Enviar campaña"}
            </Button>
          </div>
        </>
      ) : null}
    </Card>
  );
}

export function BroadcastsView() {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const inSetup = useSetupMode();
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    broadcastsApi.list().then((r) => setItems(r.items), (e: unknown) => setError(describeError(e)));
  }, []);
  useEffect(load, [load]);

  const cancel = async (id: string) => {
    try {
      await broadcastsApi.cancel(id);
      load();
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div>
      <PageHeader title="Campañas" subtitle="Envíos masivos con plantillas aprobadas de WhatsApp a contactos con consentimiento." />
      <Alert>{error}</Alert>
      {creating ? (
        <CreateWizard
          onCancel={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            load();
          }}
        />
      ) : (
        <>
          {inSetup ? <SetupRequiredHint className="mb-2" /> : null}
          <Button className="mb-6" disabled={inSetup} onClick={() => setCreating(true)}>
            Nueva campaña
          </Button>
        </>
      )}
      {items.length === 0 && !creating ? (
        <EmptyState title="Aún no hay campañas">
          Una campaña envía una plantilla aprobada de WhatsApp a un grupo de contactos por etiquetas.
          <span className="mt-4 block"><Button size="sm" disabled={inSetup} onClick={() => setCreating(true)}>Crear campaña</Button></span>
        </EmptyState>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {items.map((b) => (
          <li key={b.id}>
            <Card className="flex flex-col gap-3 !p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="m-0 font-bold">{b.name}</p>
                  <p className="m-0 text-sm text-muted">
                    {STATUS_LABELS[b.status]}
                    {b.scheduledAt ? ` · ${formatDateTime(b.scheduledAt)}` : ""} · {b.reservedSends} envíos reservados
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? "Ocultar" : "Estadísticas"}
                  </Button>
                  {b.status === "scheduled" || b.status === "sending" ? (
                    <Button variant="ghost" size="sm" onClick={() => void cancel(b.id)}>
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </div>
              {open === b.id ? <StatsPanel id={b.id} /> : null}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
