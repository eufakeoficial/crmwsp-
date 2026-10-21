"use client";

import { type FormEvent, useState } from "react";
import type { AdRecommendationSettings, MetaAdAccount, MetaAdsState } from "@crmwsp/contracts";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { adsApi } from "@/lib/ads-api";
import { formatDateTime, majorToMinor, minorToInput } from "@/lib/format";
import { errorMessage } from "@/lib/messages";

function useRunner(onChanged: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
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
  return { busy, error, notice, setError, run };
}

/** Meta Marketing API (ads_read) connection: token, ad account, sync status and "Sincronizar ahora". */
export function MetaAdsCard({ state, canEdit, onChanged }: { state: MetaAdsState; canEdit: boolean; onChanged: () => void }) {
  const conn = state.connection;
  const active = conn?.status === "active";
  const [token, setToken] = useState("");
  const [accounts, setAccounts] = useState<MetaAdAccount[]>();
  const [accountId, setAccountId] = useState(conn?.adAccountId ?? "");
  const { busy, error, notice, setError, run } = useRunner(onChanged);

  function listAccounts() {
    if (!conn && !token.trim()) return setError("Pega primero el token de acceso (permiso ads_read).");
    void run(async () => {
      const r = await adsApi.adAccounts(token.trim() || undefined);
      setAccounts(r.items);
      if (!accountId && r.items[0]) setAccountId(r.items[0].id);
    }, "Cuentas publicitarias cargadas.");
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^act_\d{1,32}$/.test(accountId.trim())) return setError("Elige una cuenta publicitaria (act_…).");
    if (!conn && !token.trim()) return setError("Pega el token de acceso de la API de marketing.");
    const picked = accounts?.find((a) => a.id === accountId.trim());
    void run(async () => {
      await adsApi.saveMetaAds({
        adAccountId: accountId.trim(),
        ...(token.trim() ? { accessToken: token.trim() } : {}),
        ...(picked ? { adAccountName: picked.name, currency: picked.currency } : {}),
      });
      setToken("");
    }, "Cuenta conectada. La primera sincronización está en cola.");
  }

  const status = active ? `Activa · ${conn?.adAccountName ?? conn?.adAccountId}${conn?.currency ? ` (${conn.currency})` : ""}` : conn ? "Desactivada" : "Sin conectar";

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[19px]">Inversión automática desde Meta Ads</h2>
        <span className="text-sm text-muted">{status}</span>
      </div>
      <p className="m-0 text-sm text-muted">
        Leemos el gasto diario por anuncio de los últimos 30 días cada 6 horas (solo lectura: nunca pausamos ni escalamos nada en Meta).
      </p>
      {conn && (
        <p className="m-0 text-sm" role="status">
          {conn.lastSyncAt ? `Última sincronización: ${formatDateTime(conn.lastSyncAt)}` : "Todavía sin sincronizar."}
          {conn.lastSyncStatus === "error" && conn.lastSyncError ? ` · Error: ${conn.lastSyncError}` : ""}
        </p>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="mads-token">Token de acceso (ads_read)</Label>
            <Input
              id="mads-token"
              type="password"
              autoComplete="off"
              placeholder={conn ? "Guardado; pega uno nuevo para cambiarlo" : ""}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-[240px] flex-col gap-1">
              <Label htmlFor="mads-account">Cuenta publicitaria</Label>
              {accounts && accounts.length > 0 ? (
                <select id="mads-account" className="h-10 rounded-md border border-line px-2" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name ?? a.id} · {a.id}
                      {a.currency ? ` · ${a.currency}` : ""}
                      {a.active ? "" : " (inactiva)"}
                    </option>
                  ))}
                </select>
              ) : (
                <Input id="mads-account" value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="act_1234567890" />
              )}
            </div>
            <Button type="button" variant="ghost" disabled={busy} onClick={listAccounts}>
              Ver mis cuentas
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{conn ? "Guardar" : "Conectar"}</Button>
            {active && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => adsApi.syncMetaAds(), "Sincronización en cola; tarda unos minutos.")}>
                Sincronizar ahora
              </Button>
            )}
            {active && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void run(() => adsApi.disableMetaAds(), "Sincronización desactivada.")}>
                Desactivar
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

/** Thresholds of the escalar / pausar recommendations (account currency). */
export function RecommendationSettingsCard({
  settings,
  currency,
  canEdit,
  onChanged,
}: {
  settings: AdRecommendationSettings;
  currency: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [target, setTarget] = useState(String(settings.targetRoas));
  const [breakEven, setBreakEven] = useState(String(settings.breakEvenRoas));
  const [minSpend, setMinSpend] = useState(minorToInput(settings.minSpendMinor, currency));
  const [minConv, setMinConv] = useState(String(settings.minConversations));
  const [pauseSpend, setPauseSpend] = useState(minorToInput(settings.pauseSpendMinor, currency));
  const { busy, error, notice, setError, run } = useRunner(onChanged);

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = Number(target.replace(",", "."));
    const b = Number(breakEven.replace(",", "."));
    const ms = majorToMinor(minSpend, currency);
    const ps = majorToMinor(pauseSpend, currency);
    const mc = Number(minConv);
    if (!(t > 0) || !(b > 0) || b > t) return setError("El ROAS objetivo debe ser mayor o igual que el de equilibrio, y ambos positivos.");
    if (ms === undefined || ps === undefined || !Number.isInteger(mc) || mc < 0) return setError("Revisa los importes y el mínimo de conversaciones.");
    void run(
      () => adsApi.saveSettings({ targetRoas: t, breakEvenRoas: b, minSpendMinor: ms, minConversations: mc, pauseSpendMinor: ps }),
      "Umbrales guardados.",
    );
  }

  const field = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="flex w-40 flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" value={value} disabled={!canEdit} onChange={(e) => set(e.target.value)} />
    </div>
  );

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <h2 className="m-0 text-[19px]">Recomendaciones: umbrales</h2>
      <p className="m-0 text-sm text-muted">
        «Escalar» si el ROAS supera el objetivo en el periodo y en los últimos 7 días; «Pausar» si gasta sin compras o queda bajo el equilibrio 7 días; «Observar» si faltan datos. Importes en {currency}.
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
        {field("rec-target", "ROAS objetivo (×)", target, setTarget)}
        {field("rec-be", "ROAS de equilibrio (×)", breakEven, setBreakEven)}
        {field("rec-minspend", "Inversión mínima", minSpend, setMinSpend)}
        {field("rec-minconv", "Conversaciones mínimas", minConv, setMinConv)}
        {field("rec-pause", "Pausar si gasta sin compras", pauseSpend, setPauseSpend)}
        {canEdit && <Button type="submit" disabled={busy}>Guardar umbrales</Button>}
      </form>
    </Card>
  );
}
