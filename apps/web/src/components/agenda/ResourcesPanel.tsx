"use client";

import { putAvailabilityRequestSchema, type AvailabilityWindow, type BookingResource, type TimeOff } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { Alert, Button, Input, Label, Modal, StatusChip, Switch } from "@/components/ui";
import { WEEKDAY_LABELS, WEEKDAY_ORDER, formatDateTimeIn, zonedInstant } from "@/lib/agenda";
import { bookingsApi } from "@/lib/bookings-api";
import { configErrorMessage } from "./ServicesPanel";

const browserTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function ResourceDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState(browserTz());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.createResource({ name: name.trim(), timezone: timezone.trim() });
      onSaved();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Nuevo recurso"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={!name.trim() || !timezone.trim() || busy} onClick={() => void submit()}>{busy ? "Guardando…" : "Crear recurso"}</Button>
        </>
      }
    >
      <p className="m-0 text-sm text-muted">Un recurso es quien o lo que se reserva: una persona del equipo, un consultorio, una sala.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="res-name">Nombre</Label>
        <Input id="res-name" maxLength={120} placeholder="Dra. Pérez" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="res-tz">Zona horaria</Label>
        <Input id="res-tz" list="res-tz-list" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        <datalist id="res-tz-list">
          {zones.map((z) => <option key={z} value={z} />)}
        </datalist>
      </div>
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
    </Modal>
  );
}

/** Weekly hours: any number of non-overlapping windows per weekday, in the resource's local time. */
function ScheduleDialog({ resource, onClose }: { resource: BookingResource; onClose: () => void }) {
  const [windows, setWindows] = useState<AvailabilityWindow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    bookingsApi.weeklyHours(resource.id).then(
      (r) => setWindows(r.windows),
      (err) => {
        setError(err);
        setWindows([]);
      },
    );
  }, [resource.id]);

  const edit = (index: number, patch: Partial<AvailabilityWindow>) => {
    setInvalid(false);
    setWindows((list) => list?.map((w, i) => (i === index ? { ...w, ...patch } : w)) ?? list);
  };

  async function save() {
    if (!windows) return;
    const parsed = putAvailabilityRequestSchema.safeParse({ windows });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await bookingsApi.putWeeklyHours(resource.id, parsed.data.windows);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`Horario semanal · ${resource.name}`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button disabled={windows === null || busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar horario"}</Button>
        </>
      }
    >
      <p className="m-0 text-sm text-muted">Horas en la zona {resource.timezone}. Un día sin tramos no admite reservas.</p>
      {windows === null ? (
        <p className="text-muted" aria-busy="true">Cargando horario…</p>
      ) : (
        WEEKDAY_ORDER.map((weekday) => {
          const rows = windows.map((w, index) => ({ w, index })).filter((x) => x.w.weekday === weekday);
          return (
            <div key={weekday} className="flex flex-col gap-1.5 border-b border-line pb-2">
              <div className="flex items-center justify-between">
                <b className="text-sm">{WEEKDAY_LABELS[weekday]}</b>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setInvalid(false);
                    setWindows((list) => [...(list ?? []), { weekday, startTime: "09:00", endTime: "13:00" }]);
                  }}
                >
                  Añadir tramo
                </Button>
              </div>
              {rows.length === 0 ? <span className="text-sm text-muted">Cerrado</span> : null}
              {rows.map(({ w, index }) => (
                <div key={index} className="flex items-center gap-2">
                  <input type="time" aria-label={`${WEEKDAY_LABELS[weekday]}: desde`} value={w.startTime} onChange={(e) => edit(index, { startTime: e.target.value })} className="h-10 rounded-[12px] border-[1.5px] border-ink px-2" />
                  <span aria-hidden>–</span>
                  <input type="time" aria-label={`${WEEKDAY_LABELS[weekday]}: hasta`} value={w.endTime === "24:00" ? "23:59" : w.endTime} onChange={(e) => edit(index, { endTime: e.target.value })} className="h-10 rounded-[12px] border-[1.5px] border-ink px-2" />
                  <Button size="sm" variant="ghost" aria-label={`Quitar tramo del ${WEEKDAY_LABELS[weekday]}`} onClick={() => setWindows((list) => list?.filter((_, i) => i !== index) ?? list)}>
                    Quitar
                  </Button>
                </div>
              ))}
            </div>
          );
        })
      )}
      {invalid ? <Alert>Revisa los tramos: la hora de inicio debe ser anterior a la de fin y no pueden solaparse en el mismo día.</Alert> : null}
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
    </Modal>
  );
}

/** Exceptions to the weekly hours: holidays, leave, closures (blocks the resource for the range). */
function TimeOffDialog({ resource, onClose }: { resource: BookingResource; onClose: () => void }) {
  const [items, setItems] = useState<TimeOff[] | null>(null);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<unknown>(null);

  async function load() {
    try {
      setItems((await bookingsApi.timeOff(resource.id)).items);
    } catch (err) {
      setError(err);
      setItems([]);
    }
  }
  useEffect(() => {
    void load();
  }, [resource.id]);

  const startsAt = startDate ? zonedInstant(startDate, startTime, resource.timezone) : null;
  const endsAt = endDate ? zonedInstant(endDate, endTime, resource.timezone) : null;
  const valid = startsAt !== null && endsAt !== null && startsAt < endsAt;

  async function add() {
    if (!startsAt || !endsAt || !valid) return;
    try {
      await bookingsApi.createTimeOff(resource.id, { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), ...(reason.trim() ? { reason: reason.trim() } : {}) });
      setStartDate("");
      setEndDate("");
      setReason("");
      setError(null);
      await load();
    } catch (err) {
      setError(err);
    }
  }
  async function remove(t: TimeOff) {
    try {
      await bookingsApi.removeTimeOff(resource.id, t.id);
      await load();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal title={`Excepciones · ${resource.name}`} wide onClose={onClose} footer={<Button onClick={onClose}>Cerrar</Button>}>
      <p className="m-0 text-sm text-muted">Días u horas en que el recurso no atiende (vacaciones, feriados, cierres). Zona {resource.timezone}.</p>
      {items === null ? <p className="text-muted" aria-busy="true">Cargando…</p> : null}
      {items?.length === 0 ? <p className="m-0 text-sm text-muted">Sin excepciones.</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {(items ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-line px-3 py-2 text-sm">
            <span>
              {formatDateTimeIn(t.startsAt, resource.timezone)} → {formatDateTimeIn(t.endsAt, resource.timezone)}
              {t.reason ? <span className="text-muted"> · {t.reason}</span> : null}
            </span>
            <Button size="sm" variant="ghost" onClick={() => void remove(t)}>Eliminar</Button>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to-start">Desde</Label>
          <div className="flex gap-2">
            <Input id="to-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input aria-label="Hora de inicio" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="to-end">Hasta</Label>
          <div className="flex gap-2">
            <Input id="to-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Input aria-label="Hora de fin" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="to-reason">Motivo (opcional)</Label>
        <Input id="to-reason" maxLength={500} placeholder="Vacaciones" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      {startDate && endDate && !valid ? <Alert>La fecha de fin debe ser posterior a la de inicio.</Alert> : null}
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
      <div>
        <Button disabled={!valid} onClick={() => void add()}>Añadir excepción</Button>
      </div>
    </Modal>
  );
}

export function ResourcesPanel({ resources, canManage, onChanged }: { resources: readonly BookingResource[]; canManage: boolean; onChanged: () => void }) {
  const [creating, setCreating] = useState(false);
  const [schedule, setSchedule] = useState<BookingResource | null>(null);
  const [timeOff, setTimeOff] = useState<BookingResource | null>(null);
  const [error, setError] = useState<unknown>(null);

  async function toggle(r: BookingResource, active: boolean) {
    try {
      await bookingsApi.patchResource(r.id, { active });
      setError(null);
      onChanged();
    } catch (err) {
      setError(err);
    }
  }
  async function remove(r: BookingResource) {
    if (!window.confirm(`¿Eliminar el recurso «${r.name}»?`)) return;
    try {
      await bookingsApi.removeResource(r.id);
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
          <Button onClick={() => setCreating(true)}>Nuevo recurso</Button>
        </div>
      ) : null}
      {error ? <Alert>{configErrorMessage(error)}</Alert> : null}
      {resources.length === 0 ? (
        <EmptyState title="Aún no hay recursos">Crea el primero (una persona, un consultorio o una sala) y define su horario semanal.</EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {resources.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border border-line bg-white px-4 py-3">
              <span className="min-w-0 flex-1">
                <b className="block truncate">{r.name}</b>
                <span className="text-sm text-muted">{r.timezone}</span>
              </span>
              {!r.active ? <StatusChip label="Inactivo" tone="paper" /> : null}
              {canManage ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Switch checked={r.active} label={`Recurso ${r.name} activo`} onChange={(next) => void toggle(r, next)} />
                  <Button size="sm" variant="outline" onClick={() => setSchedule(r)}>Horario</Button>
                  <Button size="sm" variant="outline" onClick={() => setTimeOff(r)}>Excepciones</Button>
                  <Button size="sm" variant="ghost" onClick={() => void remove(r)}>Eliminar</Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {creating ? (
        <ResourceDialog
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onChanged();
          }}
        />
      ) : null}
      {schedule ? <ScheduleDialog resource={schedule} onClose={() => setSchedule(null)} /> : null}
      {timeOff ? <TimeOffDialog resource={timeOff} onClose={() => setTimeOff(null)} /> : null}
    </div>
  );
}
