"use client";

import type { AvailableSlot, BookingResource, BookingService } from "@crmwsp/contracts";
import { useEffect, useState } from "react";
import { Alert, Input, Label } from "@/components/ui";
import { formatTimeIn, todayKey, zonedDayRange } from "@/lib/agenda";
import { bookingsApi } from "@/lib/bookings-api";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/messages";

export interface SlotChoice {
  resourceId: string;
  startsAt: string;
}

const SELECT = "h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px] disabled:opacity-50";

/** Service + resource + day, then the free slots of that day (net of hours, time off and bookings). */
export function SlotPicker({
  services,
  resources,
  serviceId,
  onServiceId,
  lockService = false,
  resourceId,
  onResourceId,
  value,
  onChange,
}: {
  services: readonly BookingService[];
  resources: readonly BookingResource[];
  serviceId: string;
  onServiceId: (id: string) => void;
  lockService?: boolean;
  resourceId: string;
  onResourceId: (id: string) => void;
  value: SlotChoice | null;
  onChange: (next: SlotChoice | null) => void;
}) {
  const [date, setDate] = useState(todayKey());
  const [slots, setSlots] = useState<AvailableSlot[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const resourceById = new Map(resources.map((r) => [r.id, r]));
  const dayTz = resourceById.get(resourceId)?.timezone ?? resources[0]?.timezone ?? "UTC";

  useEffect(() => {
    if (!serviceId || !date) {
      setSlots([]);
      return;
    }
    let cancelled = false;
    setSlots(null);
    setError(null);
    const range = zonedDayRange(date, dayTz);
    bookingsApi.slots({ serviceId, from: range.from, to: range.to, resourceId: resourceId || undefined, stepMinutes: 15 }).then(
      (r) => !cancelled && setSlots(r.slots),
      (err) => {
        if (cancelled) return;
        setError(err);
        setSlots([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [serviceId, resourceId, date, dayTz]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="slot-service">Servicio</Label>
        <select id="slot-service" className={SELECT} value={serviceId} disabled={lockService} onChange={(e) => { onServiceId(e.target.value); onChange(null); }}>
          <option value="">Elige un servicio</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.durationMinutes} min</option>
          ))}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slot-resource">Recurso</Label>
          <select id="slot-resource" className={SELECT} value={resourceId} onChange={(e) => { onResourceId(e.target.value); onChange(null); }}>
            <option value="">Cualquiera disponible</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slot-date">Día</Label>
          <Input id="slot-date" type="date" value={date} min={todayKey()} onChange={(e) => { setDate(e.target.value); onChange(null); }} />
        </div>
      </div>
      <div>
        <p className="m-0 mb-1.5 text-sm font-bold">Horarios libres</p>
        {error ? <Alert>{errorMessage(error)}</Alert> : null}
        {!serviceId ? (
          <p className="m-0 text-sm text-muted">Elige un servicio para ver los horarios.</p>
        ) : slots === null ? (
          <p className="m-0 text-sm text-muted" aria-busy="true">Buscando horarios…</p>
        ) : slots.length === 0 && !error ? (
          <p className="m-0 text-sm text-muted">No hay horarios libres ese día. Prueba con otro día o revisa el horario semanal del recurso.</p>
        ) : (
          <ul className="m-0 flex max-h-44 list-none flex-wrap gap-1.5 overflow-y-auto p-0" role="listbox" aria-label="Horarios libres">
            {slots.map((s) => {
              const r = resourceById.get(s.resourceId);
              const selected = value?.startsAt === s.startsAt && value.resourceId === s.resourceId;
              return (
                <li key={`${s.resourceId}-${s.startsAt}`}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => onChange({ resourceId: s.resourceId, startsAt: s.startsAt })}
                    className={cn(
                      "cursor-pointer rounded-full border-[1.5px] px-3 py-1.5 text-sm font-bold",
                      selected ? "border-royal bg-royal text-white" : "border-line bg-white text-ink hover:border-ink",
                    )}
                  >
                    {formatTimeIn(s.startsAt, r?.timezone ?? dayTz)}
                    {!resourceId && resources.length > 1 && r ? <span className="font-normal"> · {r.name}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
