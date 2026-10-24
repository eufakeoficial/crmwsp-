"use client";

import { useState } from "react";
import { Alert, Button, Input, Label, Modal } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { contactCreateApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";

/** Id of the contact that already owns the phone, from a 409 CONFLICT (`details.contactId`). */
export function duplicateContactId(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.code !== "CONFLICT") return null;
  const id = (err.details as { contactId?: unknown } | undefined)?.contactId;
  return typeof id === "string" ? id : null;
}

const isInvalid = (err: unknown): boolean => err instanceof ApiError && err.code === "VALIDATION_ERROR";

/** Manual "Nuevo contacto" form. The API normalizes the phone to E.164 and enforces the plan limit. */
export function NewContactDialog({
  onClose,
  onCreated,
  onOpenExisting,
}: {
  onClose: () => void;
  onCreated: (contactId: string) => void;
  onOpenExisting: (contactId: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const duplicateId = duplicateContactId(error);
  const canSubmit = phone.trim().length >= 5 && !busy;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const created = await contactCreateApi.create({
        phone: phone.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
      });
      onCreated(created.id);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nuevo contacto"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!canSubmit} onClick={() => void submit()}>{busy ? "Guardando…" : "Crear contacto"}</Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void submit();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-contact-phone">Teléfono (con código de país)</Label>
          <Input id="new-contact-phone" type="tel" inputMode="tel" autoComplete="off" placeholder="+591 7000 0001" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-contact-name">Nombre (opcional)</Label>
          <Input id="new-contact-name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-contact-email">Correo (opcional)</Label>
          <Input id="new-contact-email" type="email" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
      </form>
      {duplicateId ? (
        <Alert>
          Ya existe un contacto con ese teléfono.{" "}
          <button type="button" className="cursor-pointer bg-transparent font-bold underline" onClick={() => onOpenExisting(duplicateId)}>
            Ver contacto
          </button>
        </Alert>
      ) : error ? (
        <Alert>{isInvalid(error) ? "Revisa el teléfono: usa el formato internacional, por ejemplo +591 7000 0001." : errorMessage(error)}</Alert>
      ) : null}
    </Modal>
  );
}
