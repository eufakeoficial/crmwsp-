"use client";

import type { BookingService } from "@crmwsp/contracts";
import { useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { CURRENCIES } from "@/components/ai/BudgetFields";
import { Alert, Button, Input, Label, Modal, StatusChip, Switch } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { bookingsApi } from "@/lib/bookings-api";
import { formatMoneyMinor, majorToMinor, minorToInput } from "@/lib/format";
import { errorMessage } from "@/lib/messages";

/** Spanish text for agenda configuration errors (a CONFLICT here means "still has bookings"). */
export function configErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "CONFLICT") return "Tiene reservas asociadas: desactívalo en lugar de eliminarlo.";
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return "Revisa los datos: hay un valor fuera de rango o con formato no válido.";
  return errorMessage(err);
}

function ServiceDialog({ service, onClose, onSaved }: { service: BookingService | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(service?.name ?? "");
  const [duration, setDuration] = useState(String(service?.durationMinutes ?? 30));
  const [buffer, setBuffer] = useState(String(service?.bufferMinutes ?? 0));
  const [currency, setCurrency] = useState(service?.currency ?? "EUR");
  const [price, setPrice] = useState(service?.priceMinor != null && service.currency ? minorToInput(service.priceMinor, service.currency) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const minutes = Number(duration);
  const bufferMinutes = Number(buffer);
  const priceMinor = price.trim() ? majorToMinor(price, currency) : null;
  const valid =
    name.trim().length > 0 &&
    Number.isInteger(minutes) && minutes >= 5 && minutes <= 720 &&
    Number.isInteger(bufferMinutes) && bufferMinutes >= 0 && bufferMinutes <= 240 &&
    priceMinor !== undefined;

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    const body = {
      name: name.trim(),
      durationMinutes: minutes,
      bufferMinutes,
      priceMinor: priceMinor ?? null,
      currency: priceMinor === null ? null : currency,
    };
    try {
      if (service) await bookingsApi.patchService(service.id, body);
      else await bookingsApi.createService(body);
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={service ? "Editar servicio" : "Nuevo servicio"}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!valid || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Guardar"}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="svc-name">Nombre</Label>
        <Input id="svc-name" maxLength={120} placeholder="Limpieza dental" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="svc-duration">Duración (min)</Label>
          <Input id="svc-duration" type="number" min={5} max={720} step={5} value={duration} onChange={(e) => setDuration(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="svc-buffer">Descanso después (min)</Label>
          <Input id="svc-buffer" type="number" min={0} max={240} step={5} value={buffer} onChange={(e) => setBuffer(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_110px] gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="svc-price">Precio (opcional)</Label>
          <Input id="svc-price" inputMode="decimal" aria-invalid={priceMinor === undefined} placeholder="0,00" value={price} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="svc-currency">Moneda</Label>
          <select id="svc-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px]">
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
      </div>
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
    </Modal>
  );
}

export function ServicesPanel({ services, canManage, onChanged }: { services: readonly BookingService[]; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState<BookingService | "new" | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function toggle(s: BookingService, active: boolean) {
    try {
      await bookingsApi.patchService(s.id, { active });
      setError(null);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }
  async function remove(s: BookingService) {
    if (!window.confirm(`¿Eliminar el servicio «${s.name}»?`)) return;
    try {
      await bookingsApi.removeService(s.id);
      setError(null);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {canManage ? (
        <div>
          <Button onClick={() => setEditing("new")}>Nuevo servicio</Button>
        </div>
      ) : null}
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
      {services.length === 0 ? (
        <EmptyState title="Aún no hay servicios">Un servicio define qué se reserva: su duración, el descanso entre citas y, si quieres, su precio.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border border-line bg-white px-4 py-3">
              <span className="min-w-0 flex-1">
                <b className="block truncate">{s.name}</b>
                <span className="text-sm text-muted">
                  {s.durationMinutes} min{s.bufferMinutes ? ` + ${s.bufferMinutes} min de descanso` : ""}
                  {s.priceMinor != null && s.currency ? ` · ${formatMoneyMinor(s.priceMinor, s.currency)}` : ""}
                </span>
              </span>
              {!s.active ? <StatusChip label="Inactivo" tone="paper" /> : null}
              {canManage ? (
                <span className="flex items-center gap-2">
                  <Switch checked={s.active} label={`Servicio ${s.name} activo`} onChange={(next) => void toggle(s, next)} />
                  <Button size="sm" variant="outline" onClick={() => setEditing(s)}>Editar</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(s)}>Eliminar</Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <ServiceDialog
          service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}
