"use client";

import { useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card } from "@/components/ui";
import { companyNameChanged, companyNameIssue } from "@/lib/company-name";
import { errorMessage } from "@/lib/messages";
import { tenantApi } from "@/lib/tenant-api";
import { useToast } from "@/lib/hooks/use-toast";

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
      {({ role }) => <CompanyForm canEdit={canManageAi(role as Parameters<typeof canManageAi>[0])} />}
    </SettingsFrame>
  );
}
