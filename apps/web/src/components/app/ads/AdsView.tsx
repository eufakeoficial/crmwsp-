"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { AdReportRow, MetaCapiState } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { adsApi } from "@/lib/ads-api";
import { formatMoneyMinor, majorToMinor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";

function SpendForm({ onSaved }: { onSaved: () => void }) {
  const [sourceId, setSourceId] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cur = currency.trim().toUpperCase();
    const minor = majorToMinor(amount, cur);
    if (!sourceId.trim() || minor === undefined) return setError("Indica el ID del anuncio y un importe válido.");
    setBusy(true);
    setError(undefined);
    try {
      await adsApi.saveSpend({ sourceId: sourceId.trim(), currency: cur, amountMinor: minor, ...(label.trim() ? { label: label.trim() } : {}) });
      setAmount("");
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="spend-ad">ID del anuncio</Label>
        <Input id="spend-ad" value={sourceId} onChange={(e) => setSourceId(e.target.value)} placeholder="120210000000001" />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="spend-label">Nombre (opcional)</Label>
        <Input id="spend-label" value={label} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="flex w-24 flex-col gap-1">
        <Label htmlFor="spend-cur">Moneda</Label>
        <Input id="spend-cur" maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} />
      </div>
      <div className="flex w-36 flex-col gap-1">
        <Label htmlFor="spend-amount">Inversión total</Label>
        <Input id="spend-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Button type="submit" disabled={busy}>Guardar inversión</Button>
      {error && <Alert>{error}</Alert>}
    </form>
  );
}

function ReportTable({ items }: { items: AdReportRow[] }) {
  if (items.length === 0) return <p className="m-0 text-sm text-muted">Todavía no hay conversaciones que vengan de anuncios Click-to-WhatsApp.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-muted">
          <tr>
            <th className="py-2 pr-3">Anuncio</th>
            <th className="py-2 pr-3 text-right">Conversaciones</th>
            <th className="py-2 pr-3 text-right">Pedidos</th>
            <th className="py-2 pr-3 text-right">Pagados</th>
            <th className="py-2 pr-3 text-right">Ingresos verificados</th>
            <th className="py-2 pr-3 text-right">Inversión</th>
            <th className="py-2 text-right">ROAS</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => {
            const lines = r.byCurrency.length > 0 ? r.byCurrency : [null];
            return lines.map((c, i) => (
              <tr key={`${r.sourceId}-${c?.currency ?? "none"}`} className="border-t border-border">
                {i === 0 && (
                  <>
                    <td className="py-2 pr-3" rowSpan={lines.length}>
                      <div className="font-medium">{r.label ?? r.headline ?? (r.sourceId === "unknown" ? "Sin ID de anuncio" : r.sourceId)}</div>
                      {r.sourceId !== "unknown" && <div className="text-xs text-muted">{r.sourceId}</div>}
                    </td>
                    <td className="py-2 pr-3 text-right" rowSpan={lines.length}>{r.conversations}</td>
                    <td className="py-2 pr-3 text-right" rowSpan={lines.length}>{r.orders}</td>
                    <td className="py-2 pr-3 text-right" rowSpan={lines.length}>{r.paidOrders}</td>
                  </>
                )}
                <td className="py-2 pr-3 text-right">{c ? formatMoneyMinor(c.revenueMinor, c.currency) : "—"}</td>
                <td className="py-2 pr-3 text-right">{c && c.spendMinor > 0 ? formatMoneyMinor(c.spendMinor, c.currency) : "—"}</td>
                <td className="py-2 text-right">{c?.roas != null ? `${c.roas.toFixed(2)}×` : "—"}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

function CapiCard({ state, canEdit, onChanged }: { state: MetaCapiState; canEdit: boolean; onChanged: () => void }) {
  const conn = state.connection;
  const [datasetId, setDatasetId] = useState(conn?.datasetId ?? "");
  const [token, setToken] = useState("");
  const [testCode, setTestCode] = useState(conn?.testEventCode ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const active = conn?.status === "active";

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await fn();
      setNotice(ok);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{5,32}$/.test(datasetId.trim())) return setError("El ID del píxel / dataset son solo dígitos.");
    if (!conn && !token.trim()) return setError("Pega el token de acceso de la API de conversiones.");
    void run(async () => {
      await adsApi.saveCapi({
        datasetId: datasetId.trim(),
        ...(token.trim() ? { accessToken: token.trim() } : {}),
        testEventCode: testCode.trim() || null,
      });
      setToken("");
    }, "Configuración guardada.");
  }

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[19px]">API de conversiones de Meta</h2>
        <span className="text-sm text-muted">{active ? `Activa${conn?.tokenHint ? ` · ${conn.tokenHint}` : ""}` : conn ? "Desactivada" : "Sin configurar"}</span>
      </div>
      <p className="m-0 text-sm text-muted">
        Enviamos a Meta los eventos Lead (primer mensaje desde un anuncio) y Purchase (pedido pagado y verificado) de los contactos que llegaron por Click-to-WhatsApp.
      </p>
      {conn && (
        <p className="m-0 text-sm">
          Enviados: {conn.sent} · Pendientes: {conn.pending} · Descartados: {conn.dead}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="capi-dataset">ID del píxel / dataset</Label>
            <Input id="capi-dataset" inputMode="numeric" value={datasetId} onChange={(e) => setDatasetId(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="capi-token">Token de acceso</Label>
            <Input id="capi-token" type="password" autoComplete="off" placeholder={conn ? "Guardado; pega uno nuevo para cambiarlo" : ""} value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="capi-test">Código de prueba (opcional)</Label>
            <Input id="capi-test" value={testCode} onChange={(e) => setTestCode(e.target.value)} placeholder="TEST12345" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{conn ? "Actualizar" : "Conectar"}</Button>
            {active && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => adsApi.disableCapi(), "Envío desactivado.")}>
                Desactivar
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

function Body({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<AdReportRow[]>();
  const [capi, setCapi] = useState<MetaCapiState>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([adsApi.report(), adsApi.capi()]);
      setItems(r.items);
      setCapi(c);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!items || !capi) return <p className="text-muted" aria-busy="true">Cargando anuncios…</p>;
  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <Card className="flex flex-col gap-4 sm:p-6">
        <h2 className="m-0 text-[19px]">Rendimiento por anuncio</h2>
        <p className="m-0 text-sm text-muted">
          Atribución al primer anuncio por contacto. Los ingresos solo cuentan pedidos con pago verificado por la pasarela o conciliación.
        </p>
        <ReportTable items={items} />
        {canEdit && <SpendForm onSaved={() => void load()} />}
      </Card>
      <CapiCard key={capi.connection?.updatedAt ?? "none"} state={capi} canEdit={canEdit} onChanged={() => void load()} />
    </div>
  );
}

export function AdsView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Anuncios" subtitle="Click-to-WhatsApp: conversaciones, ventas y ROAS por anuncio.">
      {() => <Body canEdit={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}
