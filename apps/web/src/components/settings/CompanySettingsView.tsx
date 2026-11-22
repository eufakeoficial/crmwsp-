"use client";

import { useEffect, useMemo, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card } from "@/components/ui";
import { companyNameChanged, companyNameIssue } from "@/lib/company-name";
import { formatZoneTime, suggestedZone, timezoneOptions } from "@/lib/company-timezone";
import { errorMessage } from "@/lib/messages";
import { tenantApi } from "@/lib/tenant-api";
import { useToast } from "@/lib/hooks/use-toast";

function TimezoneCard({ canEdit }: { canEdit: boolean }) {
  const { renameTenant } = useSession();
  const [saved, setSaved] = useState<string>();
  const [zone, setZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [now, setNow] = useState(() => new Date());
  const toast = useToast(3000);

  useEffect(() => {
    let live = true;
    tenantApi
      .get()
      .then((t) => {
        if (!live) return;
        const tz = t.timezone ?? "Europe/Madrid";
        setSaved(tz);
        setZone(tz);
      })
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const options = useMemo(() => timezoneOptions(saved), [saved]);
  const browser = saved ? suggestedZone(Intl.DateTimeFormat().resolvedOptions().timeZone, saved) : null;
  const time = zone ? formatZoneTime(zone, now) : null;

  async function save(next: string) {
    setBusy(true);
    setError(undefined);
    try {
      const t = await tenantApi.rename({ timezone: next });
      renameTenant(t.id, t.name);
      setSaved(t.timezone ?? next);
      setZone(t.timezone ?? next);
      toast.show("Zona horaria actualizada.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">Zona horaria</h2>
        <p className="m-0 text-sm text-muted-foreground">Define la hora que usa la IA con tus clientes, los seguimientos automáticos y los reportes.</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {toast.message ? <Alert tone="info">{toast.message}</Alert> : null}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Zona horaria
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value)}
          disabled={!canEdit || busy || !saved}
          className="h-10 rounded-lg border border-line bg-white px-3 text-sm font-normal"
        >
          <optgroup label="Más usadas">
            {options.common.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </optgroup>
          <optgroup label="Todas las zonas">
            {options.others.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </optgroup>
        </select>
      </label>
      {time ? <p className="m-0 text-sm text-muted-foreground" data-testid="timezone-preview">Ahora son {time} en esta zona</p> : null}
      {canEdit && browser && browser !== zone ? (
        <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="timezone-suggestion">
          <span>Tu navegador está en {browser}. ¿Usar esa zona?</span>
          <Button onClick={() => setZone(browser)} disabled={busy}>Usar {browser}</Button>
        </div>
      ) : null}
      {canEdit ? (
        <div>
          <Button onClick={() => void save(zone)} disabled={busy || !saved || zone === saved}>
            {busy ? "Guardando…" : "Guardar zona horaria"}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">Solo un propietario o administrador puede cambiar la zona horaria.</p>
      )}
    </Card>
  );
}

function CompanyForm({ canEdit }: { canEdit: boolean }) {
  const { tenant, renameTenant } = useSession();
  const saved = tenant?.name ?? "";
  const [name, setName] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const toast = useToast(3000);
  const issue = companyNameIssue(name);
  const dirty = companyNameChanged(name, saved);

  async function save() {
    if (!tenant) return;
    setBusy(true);
    setError(undefined);
    try {
      const t = await tenantApi.rename({ name: name.trim() });
      renameTenant(t.id, t.name);
      setName(t.name);
      toast.show("Nombre de la empresa actualizado.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">Nombre de la empresa</h2>
        <p className="m-0 text-sm text-muted-foreground">Es el nombre que ves en el selector de empresa. El identificador de la cuenta no cambia.</p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {toast.message ? <Alert tone="info">{toast.message}</Alert> : null}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Nombre
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={!canEdit || busy}
          maxLength={120}
          className="h-10 rounded-lg border border-line px-3 text-sm font-normal"
        />
      </label>
      {dirty && issue ? <p className="m-0 text-sm text-red-600">{issue}</p> : null}
      {canEdit ? (
        <div>
          <Button onClick={() => void save()} disabled={busy || !dirty || issue !== null}>
            {busy ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      ) : (
        <p className="m-0 text-sm text-muted-foreground">Solo un propietario o administrador puede cambiar el nombre.</p>
      )}
    </Card>
  );
}

export function CompanySettingsView() {
  return (
    <SettingsFrame title="Empresa" subtitle="Nombre de tu empresa en la cuenta">
      {({ role }) => {
        const canEdit = canManageAi(role as Parameters<typeof canManageAi>[0]);
        return (
          <div className="flex flex-col gap-4">
            <CompanyForm canEdit={canEdit} />
            <TimezoneCard canEdit={canEdit} />
          </div>
        );
      }}
    </SettingsFrame>
  );
}
