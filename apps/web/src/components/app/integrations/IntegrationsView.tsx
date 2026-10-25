"use client";

import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import type { CommerceConnectionView, CommerceProviderId, MercadoPagoConnection, WooConnectCodeResponse } from "@crmwsp/contracts";
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

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function WooPluginBlock({ active }: { active: boolean }) {
  const [code, setCode] = useState<WooConnectCodeResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copyNote, setCopyNote] = useState<string>();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!code) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [code]);

  async function generate() {
    setBusy(true);
    setError(undefined);
    setCopyNote(undefined);
    try {
      setCode(await integrationsApi.createWooConnectCode());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setCopyNote("Código copiado.");
    } catch {
      setCopyNote("No se pudo copiar automáticamente; selecciónalo y cópialo a mano.");
    }
  }

  const remaining = code ? new Date(code.expiresAt).getTime() - now : 0;
  const expired = !!code && remaining <= 0;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
      <h3 className="m-0 text-base">Opción recomendada: plugin de WordPress</h3>
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>
          <a href="/downloads/vendemas-woocommerce.zip" download className="underline">Descarga el plugin «Vende+ para WooCommerce»</a>
          {" "}y súbelo en tu WordPress: Plugins → Añadir nuevo → Subir plugin.
        </li>
        <li>Genera un código aquí.</li>
        <li>Pégalo en WooCommerce → Vende+ → Conectar.</li>
      </ol>
      {active && <p className="m-0 text-sm text-muted">Tienda conectada mediante plugin o manualmente.</p>}
      {error && <Alert>{error}</Alert>}
      {code && !expired && (
        <div className="flex flex-col gap-2">
          <div className="select-all rounded-md bg-paper px-4 py-3 text-center font-mono text-[22px] tracking-widest" aria-label="Código de conexión">{code.code}</div>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" onClick={() => void copy()}>Copiar</Button>
            <span className="text-sm text-muted" role="timer">Vence en {formatCountdown(remaining)}</span>
          </div>
          {copyNote && <p className="m-0 text-sm" role="status">{copyNote}</p>}
        </div>
      )}
      {expired && <p className="m-0 text-sm" role="status">Código vencido</p>}
      {(!code || expired) && (
        <div>
          <Button variant={active ? "outline" : "primary"} disabled={busy} onClick={() => void generate()}>
            {busy ? "Generando…" : active ? "Generar código para otra tienda" : "Generar código de conexión"}
          </Button>
        </div>
      )}
    </div>
  );
}

function ManualWrapper({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  if (!enabled) return <>{children}</>;
  return (
    <details className="rounded-lg border border-line p-4">
      <summary className="cursor-pointer text-sm font-medium">Conectar manualmente (avanzado)</summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

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
      {canEdit && info.id === "woocommerce" && <WooPluginBlock active={active} />}
      {canEdit && (
        <ManualWrapper enabled={info.id === "woocommerce"}>
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
        </ManualWrapper>
      )}
      {conn?.lastSyncedAt && <p className="m-0 text-xs text-muted">Última sincronización: {new Date(conn.lastSyncedAt).toLocaleString("es")}</p>}
    </Card>
  );
}

function MercadoPagoCard({ canEdit, onStatus }: { canEdit: boolean; onStatus: (active: boolean) => void }) {
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
      const saved = await integrationsApi.saveMercadoPago({ accessToken: accessToken.trim(), webhookSecret: secret.trim() });
      setConn(saved);
      onStatus(saved.status === "active");
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
          <span className="text-xs text-muted">Pégala en Mercado Pago → Tus integraciones → tu aplicación → Webhooks, en modo producción.</span>
        </div>
      )}
      {error && <Alert>{error}</Alert>}
      {notice && <p className="m-0 text-sm" role="status">{notice}</p>}
      {canEdit && conn !== undefined && (
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="mercadopago-token">Access token (APP_USR-…)</Label>
            <Input id="mercadopago-token" type="password" autoComplete="off" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            <span className="text-xs text-muted">En Mercado Pago → Tus integraciones → tu aplicación → Credenciales de producción.</span>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="mercadopago-secret">Clave secreta del webhook</Label>
            <Input id="mercadopago-secret" type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
            <span className="text-xs text-muted">En Mercado Pago → Tus integraciones → tu aplicación → Webhooks, al configurar la URL de producción.</span>
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
  const [mpActive, setMpActive] = useState(false);
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
    // Mercado Pago status for its tile; the card reloads its own details when opened.
    integrationsApi.getMercadoPago().then((c) => setMpActive(c.status === "active")).catch(() => undefined);
  }, [load]);
  // One provider expanded at a time; the rest stay as compact tiles so the page fits without scrolling.
  const [open, setOpen] = useState<string | null>(null);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <p className="text-muted" aria-busy="true">Cargando integraciones…</p>;
  const connOf = (id: string) => items.find((c) => c.provider === id);
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));

  const sections: { title: string; hint: string; providers: ProviderInfo[] }[] = [
    { title: "Tiendas online", hint: "Pedidos y catálogo sincronizados.", providers: PROVIDERS.filter((p) => p.store) },
    { title: "Infoproductos", hint: "Avisos de venta por webhook.", providers: PROVIDERS.filter((p) => !p.store) },
  ];

  return (
    <div className="flex max-w-[980px] flex-col gap-6">
      <p className="m-0 text-sm text-muted">
        Elige la plataforma que usas y conéctala. Las ventas externas se registran para métricas y avisos; nunca marcan como pagado un pedido de CRMWSP.
      </p>
      {sections.map((s) => (
        <section key={s.title} aria-label={s.title} className="flex flex-col gap-3">
          <div>
            <h2 className="m-0 text-[17px]">{s.title}</h2>
            <p className="m-0 text-sm text-muted">{s.hint}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {s.providers.map((p) => (
              <ProviderTile key={p.id} name={p.name} active={connOf(p.id)?.status === "active"} open={open === p.id} panelId={`int-${p.id}`} onClick={() => toggle(p.id)} />
            ))}
          </div>
          {s.providers.filter((p) => p.id === open).map((p) => (
            <div key={p.id} id={`int-${p.id}`}>
              <ProviderCard info={p} conn={connOf(p.id)} canEdit={canEdit} onChanged={() => void load()} />
            </div>
          ))}
        </section>
      ))}
      <section aria-label="Pagos" className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-[17px]">Pagos</h2>
          <p className="m-0 text-sm text-muted">Cobra pedidos con links de pago.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <ProviderTile name="Mercado Pago" active={mpActive} open={open === "mercadopago"} panelId="int-mercadopago" onClick={() => toggle("mercadopago")} />
          <ProviderTile name="Mercado Libre" soon />
        </div>
        {open === "mercadopago" && (
          <div id="int-mercadopago">
            <MercadoPagoCard canEdit={canEdit} onStatus={setMpActive} />
          </div>
        )}
      </section>
    </div>
  );
}

/** Compact tile: name + connection status. Click expands the provider's form below the grid. */
function ProviderTile({ name, active = false, open = false, soon = false, panelId, onClick }: { name: string; active?: boolean; open?: boolean; soon?: boolean; panelId?: string; onClick?: () => void }) {
  const cls = `flex min-h-[64px] items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-left ${open ? "border-ink bg-ink text-white" : "border-line bg-white"}`;
  const status = soon ? "Próximamente" : active ? "Conectado" : "Sin conectar";
  const dot = soon ? "bg-line-2" : active ? "bg-success" : "bg-line-2";
  const content = (
    <>
      <span className="flex min-w-0 flex-col">
        <b className="truncate text-[15px]">{name}</b>
        <span className={`text-xs ${open ? "text-white/70" : "text-muted"}`}>{status}</span>
      </span>
      <span aria-hidden className={`size-2.5 flex-none rounded-full ${dot}`} />
    </>
  );
  if (soon) return <div className={`${cls} opacity-60`}>{content}</div>;
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-controls={panelId} className={`${cls} cursor-pointer transition hover:border-ink`}>
      {content}
    </button>
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
