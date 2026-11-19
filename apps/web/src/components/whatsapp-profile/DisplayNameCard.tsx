"use client";

import { requestDisplayNameRequestSchema } from "@crmwsp/contracts";
import { useState, type FormEvent } from "react";
import { AiAssistButton, Alert, Button, Card, Input, Label } from "@/components/ui";
import { buildDisplayNamePrompt } from "@/lib/ai-assist-prompts";
import { profileErrorMessage, whatsappProfileApi } from "@/lib/whatsapp-profile-api";

/** Display-name change request. Meta must approve it, so the card says so up front. */
export function DisplayNameCard({ channelId, phone, onSent }: { channelId: string; phone: string; onSent: (message: string) => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = requestDisplayNameRequestSchema.safeParse({ displayName: name });
    if (!parsed.success) {
      setError("El nombre debe tener 3 caracteres o más, solo letras, números, espacios, guiones o paréntesis, y no estar todo en mayúsculas.");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await whatsappProfileApi.requestDisplayName(channelId, parsed.data);
      setName("");
      onSent("Solicitud enviada. Meta debe aprobarla.");
    } catch (err) {
      setError(profileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
        <h2 className="m-0 text-lg font-bold">Nombre de WhatsApp</h2>
        <p className="m-0 text-sm text-muted">
          Es el nombre que aparece en el chat de tus clientes. Meta debe aprobarlo (de unas horas a 2 días) y puedes pedir hasta 3 cambios por día.
        </p>
        <div>
          <Label htmlFor="wa-display-name">Nuevo nombre</Label>
          <Input id="wa-display-name" value={name} maxLength={249} onChange={(e) => setName(e.target.value)} placeholder="Mi Negocio" />
        </div>
        <Alert>{error}</Alert>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="outline" disabled={busy || name.trim() === ""}>{busy ? "Enviando…" : "Solicitar cambio de nombre"}</Button>
          <AiAssistButton prompt={buildDisplayNamePrompt({ phone, displayName: name.trim() || null })} label="Hacerlo con IA: pedirlo en Meta" className="" />
        </div>
      </form>
    </Card>
  );
}
