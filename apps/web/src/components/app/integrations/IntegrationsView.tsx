"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { CommerceConnectionView, CommerceProviderId, MercadoPagoConnection } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { type CatalogProviderId, integrationsApi } from "@/lib/integrations-api";
import { errorMessage } from "@/lib/messages";

interface ProviderInfo {
  id: CommerceProviderId;
  name: string;
  secretLabel: string;
  help: string;
  /** Catalog sync credentials, store platforms only. */
  store?: { locatorLabel: string; locatorPlaceholder: string; credential: "token" | "woo"; tokenLabel?: string };
}

const PROVIDERS: ProviderInfo[] = [
  { id: "shopify", name: "Shopify", secretLabel: "Client secret de la app (firma de webhooks)", help: "Crea los webhooks orders/create, orders/paid, refunds/create y products/update apuntando a la URL de abajo.", store: { locatorLabel: "Dominio de la tienda", locatorPlaceholder: "mi-tienda.myshopify.com", credential: "token", tokenLabel: "Admin API access token (para sincronizar el catálogo)" } },
  { id: "tiendanube", name: "Tiendanube", secretLabel: "Client secret de la app (firma de webhooks)", help: "Registra los webhooks order/created y order/paid de tu app apuntando a la URL de abajo. El catálogo se sincroniza con el token de la app.", store: { locatorLabel: "ID de la tienda (store_id)", locatorPlaceholder: "123456", credential: "token", tokenLabel: "Access token de la app" } },
  { id: "woocommerce", name: "WooCommerce", secretLabel: "Secreto del webhook", help: "En WooCommerce → Ajustes → Avanzado → Webhooks crea order.created, order.updated y product.updated con la URL de abajo y el mismo secreto. Para el catálogo crea una clave REST de solo lectura.", store: { locatorLabel: "URL de la tienda", locatorPlaceholder: "https://mitienda.com", credential: "woo" } },
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
  const [consumerKey, setConsumerKey] = useState("");
  const [consumerSecret, setConsumerSecret] = useState("");
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
    const store = info.store;
    void run(async () => {
      await integrationsApi.save(info.id, {
        webhookSecret: secret.trim(),
        ...(store && shopDomain.trim() ? { shopDomain: shopDomain.trim() } : {}),
        ...(store?.credential === "token" && accessToken.trim() ? { accessToken: accessToken.trim() } : {}),
        ...(store?.credential === "woo" && consumerKey.trim() ? { consumerKey: consumerKey.trim() } : {}),
        ...(store?.credential === "woo" && consumerSecret.trim() ? { consumerSecret: consumerSecret.trim() } : {}),
      });
      setSecret("");
      setAccessToken("");
      setConsumerKey("");
      setConsumerSecret("");
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
          {info.store && (
            <>
              <div className="flex flex-col gap-1">
                <Label htmlFor={`${info.id}-domain`}>{info.store.locatorLabel}</Label>
                <Input id={`${info.id}-domain`} placeholder={info.store.locatorPlaceholder} value={shopDomain} onChange={(e) => setShopDomain(e.target.value)} />
              </div>
              {info.store.credential === "token" ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor={`${info.id}-token`}>{info.store.tokenLabel}</Label>
                  <Input id={`${info.id}-token`} type="password" autoComplete="off" placeholder={conn?.hasAccessToken ? "Guardado; pega uno nuevo para cambiarlo" : ""} value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${info.id}-ck`}>Consumer key</Label>
                    <Input id={`${info.id}-ck`} type="password" autoComplete="off" placeholder={conn?.hasAccessToken ? "Guardada" : "ck_…"} value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label htmlFor={`${info.id}-cs`}>Consumer secret</Label>
                    <Input id={`${info.id}-cs`} type="password" autoComplete="off" placeholder={conn?.hasAccessToken ? "Guardado" : "cs_…"} value={consumerSecret} onChange={(e) => setConsumerSecret(e.target.value)} />
                  </div>
                </div>
              )}
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>{conn ? "Actualizar" : "Conectar"}</Button>
            {info.store && active && conn?.hasAccessToken && (
              <Button variant="outline" disabled={busy} onClick={() => void run(async () => {
                const r = await integrationsApi.syncCatalog(info.id as CatalogProviderId);
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

function MercadoPagoCard({ canEdit }: { canEdit: boolean }) {
  const [conn, setConn] = useState<MercadoPagoConnection | null | undefined>(undefined);
  const [accessToken, setAccessToken] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const load = useCallback(async () => {
    try {
      setConn(await integrationsApi.getMercadoPago());
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setConn(null);
      else setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!accessToken.trim() || !secret.trim()) return setError("Pega el access token y la clave secreta del webhook.");
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      setConn(await integrationsApi.saveMercadoPago({ accessToken: accessToken.trim(), webhookSecret: secret.trim() }));
      setAccessToken("");
      setSecret("");
      setNotice("Conexión guardada.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const active = conn?.status === "active";
  return (
    <Card className="flex flex-col gap-3 sm:p-6">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[19px]">Mercado Pago</h2>
        <span className="text-sm text-muted">{active ? `Conectado${conn?.secretKeyHint ? ` · ${conn.secretKeyHint}` : ""}` : "Sin conectar"}</span>
      </div>
      <p className="m-0 text-sm text-muted">
        Cobra pedidos con links de pago de Mercado Pago. Configura el webhook de pagos con la URL de abajo y copia aquí la clave secreta. Un pedido solo se marca pagado cuando el aviso está firmado y la API de Mercado Pago confirma el pago aprobado por el importe exacto.
      </p>
      {conn && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="mercadopago-url">URL del webhook</Label>
          <Input id="mercadopago-url" readOnly value={conn.webhookUrl} onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      {canEdit && conn !== undefined && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="mercadopago-token">Access token (APP_USR-…)</Label>
            <Input id="mercadopago-token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mercadopago-secret">Clave secreta del webhook</Label>
            <Input id="mercadopago-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
          </div>
          <div>
            <Button type="submit" disabled={busy}>{conn ? "Actualizar" : "Conectar"}</Button>
          </div>
        </form>
      )}
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
      <h2 className="m-0 mt-2 text-[17px]">Pagos</h2>
      <MercadoPagoCard canEdit={canEdit} />
      <p className="m-0 text-xs text-muted">Mercado Libre: pendiente (requiere OAuth por vendedor; ver roadmap).</p>
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
