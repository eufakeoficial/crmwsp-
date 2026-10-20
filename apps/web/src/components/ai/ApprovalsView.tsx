"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Label, Modal, Textarea, Toast } from "@/components/ui";
import { APPROVALS_CHANGED } from "@/lib/ai-actions";
import { aiApi } from "@/lib/ai-api";
import type { AiActionItem } from "@crmwsp/contracts";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { SettingsFrame } from "./AccessGate";
import { ActionCard } from "./ActionCard";

type Decision = { action: AiActionItem; kind: "approve" | "reject" };

function Body({ canDecide }: { canDecide: boolean }) {
  const [items, setItems] = useState<AiActionItem[] | null>(null);
  const [error, setError] = useState<string>();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await aiApi.listActions("pending_approval"));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function confirm() {
    if (!decision) return;
    const { action, kind } = decision;
    setDecision(null);
    setBusyId(action.id);
    try {
      await (kind === "approve" ? aiApi.approveAction(action.id, note) : aiApi.rejectAction(action.id, note));
      setItems((list) => (list ?? []).filter((a) => a.id !== action.id));
      window.dispatchEvent(new Event(APPROVALS_CHANGED));
      show(kind === "approve" ? "Acción aprobada" : "Acción rechazada");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
      setNote("");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Alert>{error}</Alert>
      {items === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando acciones…</p>
      ) : items && items.length === 0 ? (
        <EmptyState title="Nada pendiente">Cuando la IA proponga un descuento, un presupuesto o una plantilla que requiera tu visto bueno, aparecerá aquí.</EmptyState>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items?.map((a) => (
            <ActionCard key={a.id} action={a} canDecide={canDecide} busy={busyId === a.id} onDecide={(kind) => { setNote(""); setDecision({ action: a, kind }); }} />
          ))}
        </div>
      )}
      {decision ? (
        <Modal
          title={decision.kind === "approve" ? "Aprobar acción" : "Rechazar acción"}
          onClose={() => setDecision(null)}
          footer={<><Button variant="outline" onClick={() => setDecision(null)}>Cancelar</Button><Button variant={decision.kind === "approve" ? "accent" : "primary"} onClick={() => void confirm()}>{decision.kind === "approve" ? "Aprobar" : "Rechazar"}</Button></>}
        >
          <Label htmlFor="appr-note">Nota (opcional)</Label>
          <Textarea id="appr-note" data-autofocus rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </Modal>
      ) : null}
      <Toast message={message} />
    </div>
  );
}

export function ApprovalsView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Configuración" subtitle="Acciones de la IA que esperan tu aprobación antes de ejecutarse.">
      {() => <Body canDecide={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}
