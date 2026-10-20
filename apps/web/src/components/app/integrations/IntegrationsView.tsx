"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { CommerceConnectionView, CommerceProviderId } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { integrationsApi } from "@/lib/integrations-api";
import { errorMessage } from "@/lib/messages";

interface ProviderInfo {
  id: CommerceProviderId;
  name: string;
  secretLabel: string;
  help: string;
}

const PROVIDERS: ProviderInfo[] = [
  { id: "shopify", name: "Shopify", secretLabel: "Client secret de la app (firma de webhooks)", help: "Crea los webhooks orders/create, orders/paid, refunds/create y products/update apuntando a la URL de abajo." },
  { id: "hotmart", name: "Hotmart", secretLabel: "Hottok", help: "En Hotmart → Herramientas → Webhook, pega la URL de abajo (versión 2.0)." },
  { id: "kiwify", name: "Kiwify", secretLabel: "Token del webhook", help: "En Kiwify → Apps → Webhooks, pega la URL y copia aquí el token." },
  { id: "eduzz", name: "Eduzz", secretLabel: "Secreto del webhook", help: "Configura el webhook de Eduzz con la URL de abajo." },
  { id: "gumroad", name: "Gumroad", secretLabel: "Seller ID", help: "En Gumroad → Settings → Advanced → Ping, pega la URL. Gumroad no firma los avisos." },
  { id: "payhip", name: "Payhip", secretLabel: "API key", help: "En Payhip → Settings → Developer, pega la URL del webhook." },
];

function ProviderCard({ info, conn, canEdit, onChanged }: { info: ProviderInfo; conn: CommerceConnectionView | undefined; canEdit: boolean; onChanged: () => void }) {
  const [secret, setSecret] = useState("");
  const [shopDomain, setShopDomain] = useState(conn?.shopDomain ?? "");
  const [accessToken, setAccessToken] = useState("");
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
    if (!secret.trim()) return setError(`Pega el ${info.secretLabel.toLowerCase()}.`);
    const isShopify = info.id === "shopify";
    void run(async () => {
      await integrationsApi.save(info.id, {
        webhookSecret: secret.trim(),
        ...(isShopify && shopDomain.trim() ? { shopDomain: shopDomain.trim() } : {}),
        ...(isShopify && accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
      });
      setSecret("");
      setAccessToken("");
    }, "Conexión guardada.");
  }

  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[19px]">{info.name}</h2>
        <span className="text-sm text-muted">{active ? `Conectado${conn?.secretHint ? ` · ${conn.secretHint}` : ""}` : "Sin conectar"}</span>
      </div>
      <p className="m-0 text-sm text-muted">{info.help}</p>
      {conn && (
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${info.id}-url`}>URL del webhook</Label>
          <Input id={`${info.id}-url`} readOnly value={conn.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      {canEdit && (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${info.id}-secret`}>{info.secretLabel}</Label>
            <Input id={`${info.id}-secret`} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          {info.id === "shopify" && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor="shopify-domain">Dominio de la tienda</Label>
                <Input id="shopify-domain" placeholder="mi-tienda.myshopify.com" value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor="shopify-token">Admin API access token (para sincronizar el catálogo)</Label>
                <Input id="shopify-token" type="password" autoComplete="off" placeholder={conn?.hasAccessToken ? "Guardado; pega uno nuevo para cambiarlo" : ""} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
              </div>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{conn ? "Actualizar" : "Conectar"}</Button>
            {info.id === "shopify" && active && conn?.hasAccessToken && (
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                const r = await integrationsApi.syncShopify();
                setNotice(`Catálogo sincronizado: ${r.products} productos, ${r.variants} variantes.`);
              }, "Catálogo sincronizado.")}>
                Sincronizar catálogo
              </Button>
            )}
            {active && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(() => integrationsApi.disable(info.id), "Conexión desactivada.")}>
                Desactivar
              </Button>
            )}
          </div>
        </form>
      )}
      {conn?.lastSyncedAt && <p className="m-0 text-xs text-muted">Última sincronización: {new Date(conn.lastSyncedAt).toLocaleString("es")}</p>}
    </Card>
  );
}

function Body({ canEdit }: { canEdit: boolean }) {
  const [items, setItems] = useState<CommerceConnectionView[] | undefined>(undefined);
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setItems((await integrationsApi.list()).items);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <p className="text-muted" aria-busy="true">Cargando integraciones…</p>;
  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <p className="m-0 text-sm text-muted">
        Las ventas de estas plataformas se registran como ventas externas (métricas y avisos). Nunca marcan como pagado un pedido de CRMWSP.
      </p>
      {PROVIDERS.map((p) => (
        <ProviderCard key={p.id} info={p} conn={items.find((c) => c.provider === p.id)} canEdit={canEdit} onChanged={() => void load()} />
      ))}
    </div>
  );
}

export function IntegrationsView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Integraciones" subtitle="Conecta tu tienda o plataforma de infoproductos.">
      {() => <Body canEdit={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}
