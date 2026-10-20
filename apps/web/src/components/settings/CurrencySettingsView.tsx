"use client";

import { useEffect, useState } from "react";
import { SUPPORTED_CURRENCIES, type CurrencySettings } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, CheckBox, Spinner } from "@/components/ui";
import { currencyApi, currencyExample, currencySymbol } from "@/lib/currency-api";
import { errorMessage } from "@/lib/messages";

function CurrencyForm({ canEdit }: { canEdit: boolean }) {
  const [saved, setSaved] = useState<CurrencySettings>();
  const [base, setBase] = useState("");
  const [enabled, setEnabled] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [ok, setOk] = useState(false);

  useEffect(() => {
    currencyApi.get().then(
      (s) => {
        setSaved(s);
        setBase(s.base);
        setEnabled(s.enabled);
      },
      (err: unknown) => setError(errorMessage(err)),
    );
  }, []);

  if (!saved) return error ? <Alert tone="error">{error}</Alert> : <Spinner />;

  const toggle = (code: string) => {
    setOk(false);
    setEnabled((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code]));
  };
  const baseEnabled = enabled.includes(base);
  const dirty = base !== saved.base || enabled.length !== saved.enabled.length || enabled.some((c) => !saved.enabled.includes(c));

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const s = await currencyApi.patch({ base, enabled });
      setSaved(s);
      setEnabled(s.enabled);
      setOk(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">Monedas del negocio</h2>
        <p className="m-0 text-sm text-muted-foreground">
          Marca las monedas en las que vendes y elige la base: se usa por defecto en productos, presupuestos, pedidos, informes y filtros.
        </p>
      </div>
      <Alert tone="info">
        Cambiar la moneda base no convierte ni modifica importes existentes: cada producto, presupuesto, pedido y pago conserva su propia moneda. No hay tipo de cambio.
      </Alert>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {ok ? <Alert tone="info">Monedas guardadas.</Alert> : null}
      <ul className="m-0 grid list-none gap-1 p-0 sm:grid-cols-2">
        {SUPPORTED_CURRENCIES.map((c) => {
          const on = enabled.includes(c.code);
          return (
            <li key={c.code} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
              {canEdit ? <CheckBox checked={on} onChange={() => toggle(c.code)} label={`Habilitar ${c.name}`} /> : null}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">
                  {c.code} · {c.name} <span className="text-muted-foreground">({currencySymbol(c.code)})</span>
                </span>
                <span className="block text-xs text-muted-foreground">{currencyExample(c.code)}</span>
              </span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="radio"
                  name="base-currency"
                  checked={base === c.code}
                  disabled={!canEdit || !on}
                  onChange={() => {
                    setOk(false);
                    setBase(c.code);
                  }}
                />
                Base
              </label>
            </li>
          );
        })}
      </ul>
      {!baseEnabled ? <Alert tone="error">La moneda base debe estar habilitada.</Alert> : null}
      {canEdit ? (
        <div>
          <Button onClick={() => void save()} disabled={busy || !dirty || !baseEnabled || enabled.length === 0}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">Solo un propietario o administrador puede cambiar las monedas.</p>
      )}
    </Card>
  );
}

export function CurrencySettingsView() {
  return (
    <SettingsFrame title="Moneda" subtitle="Moneda base y monedas en las que vendes">
      {({ role }) => <CurrencyForm canEdit={canManageAi(role as Parameters<typeof canManageAi>[0])} />}
    </SettingsFrame>
  );
}
