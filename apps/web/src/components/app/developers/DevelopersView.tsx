"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  apiKeyScopes,
  webhookEventTypes,
  type ApiKeyScope,
  type ApiKeyView,
  type WebhookDeliveryView,
  type WebhookEndpointView,
  type WebhookEventType,
} from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { developersApi } from "@/lib/developers-api";
import { errorMessage } from "@/lib/messages";

/** Scopes offered in the UI: only those with a public endpoint (`write:messages` has none yet). */
type OfferedScope = Exclude<ApiKeyScope, "write:messages">;
const SCOPE_LABELS: Record<OfferedScope, string> = {
  "read:orders": "Leer pedidos",
  "read:contacts": "Leer contactos",
};
const OFFERED_SCOPES = apiKeyScopes.filter((s): s is OfferedScope => s !== "write:messages");

const EVENT_LABELS: Record<WebhookEventType, string> = {
  "order.created": "Pedido creado",
  "order.paid": "Pedido pagado",
  "contact.created": "Contacto nuevo",
  "message.received": "Mensaje recibido",
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleString("es") : "—");

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

/** Shows a just-created secret once, with copy. */
function OneTimeSecret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3" role="status">
      <p className="m-0 text-sm font-medium">{label} Cópialo ahora: no se volverá a mostrar.</p>
      <Input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} />
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(value)}>Copiar</Button>
        <Button variant="ghost" onClick={onDone}>Hecho</Button>
      </div>
    </div>
  );
}

function ApiKeysCard({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<ApiKeyView[]>();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<ApiKeyScope[]>(["read:orders"]);
  const [created, setCreated] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setItems((await developersApi.listKeys()).items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError("Ponle un nombre a la clave.");
    if (scopes.length === 0) return setError("Elige al menos un permiso.");
    void run(async () => {
      const k = await developersApi.createKey({ name: name.trim(), scopes });
      setCreated(k.key);
      setName("");
    });
  }

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <h2 className="m-0 text-[19px]">Claves de API</h2>
      <p className="m-0 text-sm text-muted">
        Usa <code>Authorization: Bearer &lt;clave&gt;</code> contra <code>/v1/orders</code>, <code>/v1/orders/:id</code> y <code>/v1/contacts</code>.
      </p>
      {error && <Alert>{error}</Alert>}
      {created && <OneTimeSecret label="Clave creada." value={created} onDone={() => setCreated(undefined)} />}
      {!items ? (
        <p className="text-muted" aria-busy="true">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm text-muted">Aún no hay claves.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {items.map((k) => (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 text-sm">
              <span>
                <strong>{k.name}</strong> · <code>{k.prefix}…</code> · {k.scopes.join(", ")}
                <br />
                <span className="text-muted">
                  Último uso: {fmt(k.lastUsedAt)}
                  {k.revokedAt ? ` · Revocada ${fmt(k.revokedAt)}` : ""}
                </span>
              </span>
              {canEdit && !k.revokedAt && (
                <Button variant="ghost" disabled={busy} onClick={() => void run(() => developersApi.revokeKey(k.id))}>
                  Revocar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="key-name">Nombre</Label>
            <Input id="key-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="Zapier, ERP…" />
          </div>
          <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
            <legend className="mb-1 text-sm">Permisos</legend>
            {OFFERED_SCOPES.map((s) => (
              <label key={s} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={scopes.includes(s)} onChange={() => setScopes((v) => toggle(v, s))} />
                {SCOPE_LABELS[s]}
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={busy}>Crear clave</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Deliveries({ endpointId }: { endpointId: string }) {
  const [items, setItems] = useState<WebhookDeliveryView[]>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    developersApi.deliveries(endpointId).then((r) => setItems(r.items), (err: unknown) => setError(errorMessage(err)));
  }, [endpointId]);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <p className="text-sm text-muted" aria-busy="true">Cargando entregas…</p>;
  if (items.length === 0) return <p className="m-0 text-sm text-muted">Sin entregas todavía.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            <th>Evento</th>
            <th>Estado</th>
            <th>Intentos</th>
            <th>Respuesta</th>
            <th>Fecha</th>
          </tr>
        </thead>
        <tbody>
          {items.map((d) => (
            <tr key={d.id}>
              <td>{d.eventType}</td>
              <td>{d.status === "delivered" ? "Entregado" : d.status === "failed" ? "Fallido" : "Pendiente"}</td>
              <td>{d.attempts}</td>
              <td>{d.lastStatusCode ?? d.lastError ?? "—"}</td>
              <td>{fmt(d.deliveredAt ?? d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EndpointRow({ ep, canEdit, onChanged }: { ep: WebhookEndpointView; canEdit: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <li className="flex flex-col gap-2 border-b pb-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="break-all">
          <strong>{ep.url}</strong>
          <br />
          <span className="text-muted">
            {ep.events.map((e) => EVENT_LABELS[e]).join(", ")} · {ep.status === "active" ? "Activo" : `Desactivado${ep.disabledReason === "too_many_failures" ? " por fallos repetidos" : ""}`}
            {ep.secretHint ? ` · secreto ${ep.secretHint}` : ""}
          </span>
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOpen((v) => !v)}>{open ? "Ocultar entregas" : "Ver entregas"}</Button>
          {canEdit && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => developersApi.updateEndpoint(ep.id, { status: ep.status === "active" ? "disabled" : "active" }))}>
              {ep.status === "active" ? "Desactivar" : "Reactivar"}
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" disabled={busy} onClick={() => void run(() => developersApi.deleteEndpoint(ep.id))}>
              Eliminar
            </Button>
          )}
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {open && <Deliveries endpointId={ep.id} />}
    </li>
  );
}

function WebhooksCard({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<WebhookEndpointView[]>();
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<WebhookEventType[]>(["order.paid"]);
  const [secret, setSecret] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setItems((await developersApi.listEndpoints()).items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!url.trim()) return setError("Pega la URL https de tu endpoint.");
    if (events.length === 0) return setError("Elige al menos un evento.");
    setBusy(true);
    setError(undefined);
    developersApi
      .createEndpoint({ url: url.trim(), events })
      .then(async (r) => {
        setSecret(r.secret);
        setUrl("");
        await load();
      })
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  }

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <h2 className="m-0 text-[19px]">Webhooks salientes</h2>
      <p className="m-0 text-sm text-muted">
        Enviamos un POST JSON firmado. Verifica la cabecera <code>X-CRMWSP-Signature: t=…,v1=…</code> calculando HMAC-SHA256 de{" "}
        <code>t + &quot;.&quot; + cuerpo</code> con tu secreto. Reintentamos con espera creciente y desactivamos el endpoint tras fallos repetidos.
      </p>
      {error && <Alert>{error}</Alert>}
      {secret && <OneTimeSecret label="Secreto de firma creado." value={secret} onDone={() => setSecret(undefined)} />}
      {!items ? (
        <p className="text-muted" aria-busy="true">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="m-0 text-sm text-muted">Aún no hay endpoints.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {items.map((ep) => (
            <EndpointRow key={ep.id} ep={ep} canEdit={canEdit} onChanged={() => void load()} />
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="wh-url">URL del endpoint</Label>
            <Input id="wh-url" type="url" inputMode="url" placeholder="https://tu-servidor.com/crmwsp" value={url} onChange={(e) => setUrl(e.target.value)} />
          </div>
          <fieldset className="m-0 flex flex-wrap gap-4 border-0 p-0">
            <legend className="mb-1 text-sm">Eventos</legend>
            {webhookEventTypes.map((ev) => (
              <label key={ev} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={events.includes(ev)} onChange={() => setEvents((v) => toggle(v, ev))} />
                {EVENT_LABELS[ev]}
              </label>
            ))}
          </fieldset>
          <div>
            <Button type="submit" disabled={busy}>Añadir endpoint</Button>
          </div>
        </form>
      )}
    </Card>
  );
}

export function DevelopersView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Claves de API" subtitle="Claves de API y webhooks para conectar tus sistemas.">
      {() => {
        const canEdit = canManageAi(tenant?.role);
        return (
          <div className="flex max-w-[980px] flex-col gap-4">
            <ApiKeysCard canEdit={canEdit} />
            <WebhooksCard canEdit={canEdit} />
          </div>
        );
      }}
    </SettingsFrame>
  );
}
