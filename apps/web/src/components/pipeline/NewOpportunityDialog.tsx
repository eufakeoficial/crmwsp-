"use client";

import type { ContactBookItem, Opportunity } from "@crmwsp/contracts";
import { useState } from "react";
import { CURRENCIES } from "@/components/ai/BudgetFields";
import { ContactPicker } from "@/components/contacts/ContactPicker";
import { Alert, Button, Input, Label, Modal } from "@/components/ui";
import { majorToMinor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { pipelineApi } from "@/lib/pipeline-api";

/** "Nueva oportunidad": the API puts it in the first open stage of the default pipeline. */
export function NewOpportunityDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (o: Opportunity) => void }) {
  const [contact, setContact] = useState<ContactBookItem | null>(null);
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const valueMinor = value.trim() ? majorToMinor(value, currency) : null;
  const valid = contact !== null && title.trim().length > 0 && valueMinor !== undefined;

  async function submit() {
    if (!contact || valueMinor === undefined) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await pipelineApi.create({
          contactId: contact.id,
          title: title.trim(),
          currency,
          ...(valueMinor !== null ? { valueMinor } : {}),
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nueva oportunidad"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valid || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Crear oportunidad"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <b className="text-sm">Contacto</b>
        <ContactPicker value={contact} onChange={setContact} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="opp-title">Título</Label>
        <Input id="opp-title" maxLength={200} placeholder="Reforma de cocina" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-value">Valor estimado (opcional)</Label>
          <Input id="opp-value" inputMode="decimal" aria-invalid={valueMinor === undefined} placeholder="0,00" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="opp-currency">Moneda</Label>
          <select id="opp-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px]">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
    </Modal>
  );
}
