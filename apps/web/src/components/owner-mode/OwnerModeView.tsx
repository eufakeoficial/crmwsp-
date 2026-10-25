"use client";

import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { OwnerModeStatus } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { SettingsFrame } from "@/components/ai/AccessGate";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { ownerModeApi } from "@/lib/owner-mode-api";
import { errorMessage } from "@/lib/messages";

const COMMANDS = [
  ["/resumen", "Leads nuevos, presupuestos pendientes y cobrado hoy"],
  ["/presupuestos", "Presupuestos pendientes"],
  ["/pendientes", "Acciones de la IA esperando aprobación"],
  ["/aprobar 1 · /rechazar 1", "Decide una acción (pide confirmación)"],
  ["/ventas", "Ventas verificadas de los últimos 7 días"],
  ["/buscar Juan", "Buscar cliente"],
  ["/responder Juan: mañana voy", "Borrador de respuesta al cliente (pide confirmación)"],
  ["/pausar · /activar", "IA de todo el negocio (pide confirmación)"],
] as const;

function OwnerPhoneCard({ status, onChange }: { status: OwnerModeStatus; onChange: (s: OwnerModeStatus) => void }) {
  const [phone, setPhone] = useState(status.phone?.phoneE164 ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const p = status.phone;
  const pendingCode = p?.status === "pending" && p.codeExpiresAt !== null;

  async function run(fn: () => Promise<OwnerModeStatus>) {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await fn());
      setCode("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const submitPhone = (e: FormEvent) => {
    e.preventDefault();
    void run(() => ownerModeApi.register(phone.trim()));
  };
  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    void run(() => ownerModeApi.verify(code.trim()));
  };

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div>
        <h2 className="m-0 text-base font-semibold">Tu WhatsApp</h2>
        <p className="m-0 text-sm text-muted-foreground">
          Vincula tu número personal para gestionar el CRM escribiendo al número del negocio. Tus mensajes no se tratan como los de un cliente.
        </p>
      </div>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {p?.status === "verified" ? (
        <div className="flex flex-wrap items-center gap-3" role="status">
          <span className="text-sm">
            Verificado: <strong>{p.phoneE164}</strong>
          </span>
          <Button variant="outline" disabled={busy} onClick={() => void run(() => ownerModeApi.unlink())}>
            Desvincular
          </Button>
        </div>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={submitPhone}>
          <Label htmlFor="owner-phone">Número en formato internacional</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="owner-phone" inputMode="tel" placeholder="+34600111222" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            <Button type="submit" disabled={busy || phone.trim().length < 8}>
              {pendingCode ? "Reenviar código" : "Enviar código"}
            </Button>
          </div>
        </form>
      )}
      {pendingCode ? (
        <form className="flex flex-col gap-2" onSubmit={submitCode}>
          <Label htmlFor="owner-code">Código de 6 dígitos recibido por WhatsApp</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="owner-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Button type="submit" disabled={busy || code.length !== 6}>
              Verificar
            </Button>
          </div>
          <p className="m-0 text-xs text-muted-foreground">Caduca en 10 minutos. Intentos restantes: {p?.attemptsLeft ?? 0}.</p>
        </form>
      ) : null}
    </Card>
  );
}

export function OwnerModeView() {
  const [status, setStatus] = useState<OwnerModeStatus>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    try {
      setStatus(await ownerModeApi.status());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  return (
    <SettingsFrame title="Control por WhatsApp" subtitle="Gestiona el negocio desde tu propio WhatsApp">
      {({ role }) =>
        !canManageAi(role as Parameters<typeof canManageAi>[0]) ? (
          <Alert tone="info">Solo propietarios y administradores pueden usar el modo dueño.</Alert>
        ) : (
          <div className="flex flex-col gap-4">
            {error ? <Alert tone="error">{error}</Alert> : null}
            {status ? <OwnerPhoneCard status={status} onChange={setStatus} /> : null}
            {status?.aiPaused ? <Alert tone="info">La IA está pausada desde el modo dueño. Escribe /activar para reactivarla.</Alert> : null}
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="m-0 text-base font-semibold">Qué puedes pedir</h2>
              <p className="m-0 text-sm text-muted-foreground">Escribe en lenguaje natural o usa atajos. Lo que cambia algo siempre pide confirmación con un código («sí 123456»). Nunca se marcan pagos desde WhatsApp.</p>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {COMMANDS.map(([cmd, desc]) => (
                  <li key={cmd}>
                    <code>{cmd}</code> — {desc}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )
      }
    </SettingsFrame>
  );
}
