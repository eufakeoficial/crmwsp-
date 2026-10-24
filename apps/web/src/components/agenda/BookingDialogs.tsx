"use client";

import type { Booking, BookingResource, BookingService, ContactBookItem } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { Alert, Button, Modal, SearchInput, Textarea } from "@/components/ui";
import { formatDateTimeIn } from "@/lib/agenda";
import { ApiError } from "@/lib/api";
import { bookingsApi } from "@/lib/bookings-api";
import { contactBookApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";
import { SlotPicker, type SlotChoice } from "./SlotPicker";

/** Spanish text for booking write errors (a CONFLICT here means a taken slot or a stale booking). */
export function bookingErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "CONFLICT") return "Ese horario ya no está libre o la reserva cambió. Actualiza la agenda e inténtalo de nuevo.";
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return "Ese horario no es válido (fuera del horario del recurso o en el pasado). Elige otro.";
  return errorMessage(err);
}

function ContactPicker({ value, onChange }: { value: ContactBookItem | null; onChange: (c: ContactBookItem | null) => void }) {
  const [draft, setDraft] = useState("");
  const [results, setResults] = useState<ContactBookItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function search() {
    setError(null);
    try {
      setResults((await contactBookApi.list({ q: draft.trim(), limit: 6 })).items);
    } catch (err) {
      setError(err);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-[14px] border border-line px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <b>{value.name?.trim() || "Sin nombre"}</b> <span className="text-muted">{value.phoneE164}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Cambiar</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <SearchInput label="Buscar contacto" placeholder="Nombre o teléfono del paciente o cliente" className="border-[1.5px] border-ink" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      {error ? <Alert>{errorMessage(error)}</Alert> : null}
      {results && results.length === 0 ? <p className="m-0 text-sm text-muted">Sin resultados. Crea el contacto desde Contactos con «Nuevo contacto».</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {(results ?? []).map((c) => (
          <li key={c.id}>
            <button type="button" onClick={() => onChange(c)} className="w-full cursor-pointer rounded-[12px] border border-line bg-white px-3 py-2 text-left text-sm hover:border-ink">
              <b>{c.name?.trim() || "Sin nombre"}</b> <span className="text-muted">{c.phoneE164}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "Nueva reserva": contact, service, resource, free slot, notes. The API re-checks the slot. */
export function NewBookingDialog({
  services,
  resources,
  onClose,
  onCreated,
}: {
  services: readonly BookingService[];
  resources: readonly BookingResource[];
  onClose: () => void;
  onCreated: (b: Booking) => void;
}) {
  const [contact, setContact] = useState<ContactBookItem | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [notes, setNotes] = useState("");
  const [confirmed, setConfirmed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    if (!contact || !slot || !serviceId) return;
    setBusy(true);
    setError(null);
    try {
      onCreated(
        await bookingsApi.create({
          resourceId: slot.resourceId,
          serviceId,
          contactId: contact.id,
          startsAt: slot.startsAt,
          status: confirmed ? "confirmed" : "pending",
          ...(notes.trim() ? { notes: notes.trim() } : {}),
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
      title="Nueva reserva"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!contact || !slot || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Reservar"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <b className="text-sm">Contacto</b>
        <ContactPicker value={contact} onChange={setContact} />
      </div>
      <SlotPicker services={services} resources={resources} serviceId={serviceId} onServiceId={setServiceId} resourceId={resourceId} onResourceId={setResourceId} value={slot} onChange={setSlot} />
      <label className="flex flex-col gap-1.5 text-sm font-bold">
        Notas (opcional)
        <Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 text-sm font-bold">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Marcar como confirmada
      </label>
      {error ? <Alert>{bookingErrorMessage(error)}</Alert> : null}
    </Modal>
  );
}

/** Moves a booking to another free slot (same service). Uses the lockVersion read with the booking. */
export function RescheduleDialog({
  booking,
  service,
  resources,
  onClose,
  onDone,
}: {
  booking: Booking;
  service: BookingService | undefined;
  resources: readonly BookingResource[];
  onClose: () => void;
  onDone: (b: Booking) => void;
}) {
  const [resourceId, setResourceId] = useState(booking.resourceId);
  const [slot, setSlot] = useState<SlotChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const current = resources.find((r) => r.id === booking.resourceId);

  useEffect(() => setError(null), [slot]);

  async function submit() {
    if (!slot) return;
    setBusy(true);
    try {
      onDone(await bookingsApi.reschedule(booking.id, { startsAt: slot.startsAt, resourceId: slot.resourceId, lockVersion: booking.lockVersion }));
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Reprogramar reserva"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!slot || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Mover reserva"}</Button>
        </>
      }
    >
      <p className="m-0 text-sm text-muted">
        Ahora: <b className="text-ink">{formatDateTimeIn(booking.startsAt, current?.timezone ?? "UTC")}</b>
      </p>
      <SlotPicker
        services={service ? [service] : []}
        resources={resources}
        serviceId={booking.serviceId}
        onServiceId={() => undefined}
        lockService
        resourceId={resourceId}
        onResourceId={setResourceId}
        value={slot}
        onChange={setSlot}
      />
      {error ? <Alert>{bookingErrorMessage(error)}</Alert> : null}
    </Modal>
  );
}
