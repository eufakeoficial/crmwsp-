"use client";

import type { Booking, BookingResource, BookingService } from "@crmwsp/contracts";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { Alert, Button, StatusChip } from "@/components/ui";
import {
  BOOKING_STATUS_LABELS,
  BOOKING_STATUS_TONES,
  addDays,
  formatDateKey,
  formatTimeIn,
  groupByDay,
  mondayOf,
  todayKey,
  zonedMidnight,
} from "@/lib/agenda";
import { bookingsApi } from "@/lib/bookings-api";
import { contactBookApi } from "@/lib/contacts-api";
import { NewBookingDialog, RescheduleDialog, bookingErrorMessage } from "./BookingDialogs";

type Action = "confirm" | "cancel" | "complete" | "no-show";

/** Week calendar as a day-by-day list, with create / reschedule / confirm / cancel / close-out. */
export function BookingsPanel({
  services,
  resources,
  canBook,
}: {
  services: readonly BookingService[];
  resources: readonly BookingResource[];
  canBook: boolean;
}) {
  const [monday, setMonday] = useState(mondayOf(todayKey()));
  const [resourceId, setResourceId] = useState("");
  const [items, setItems] = useState<Booking[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const [creating, setCreating] = useState(false);
  const [moving, setMoving] = useState<Booking | null>(null);

  const resourceById = useMemo(() => new Map(resources.map((r) => [r.id, r])), [resources]);
  const serviceById = useMemo(() => new Map(services.map((s) => [s.id, s])), [services]);

  const load = useCallback(async () => {
    setItems(null);
    try {
      // The week is computed in the browser's zone; each booking is then shown in its resource zone.
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const list = await bookingsApi.list({
        from: zonedMidnight(monday, tz).toISOString(),
        to: zonedMidnight(addDays(monday, 7), tz).toISOString(),
        resourceId: resourceId || undefined,
      });
      setItems(list.items);
      setError(null);
    } catch (err) {
      setError(err);
      setItems([]);
    }
  }, [monday, resourceId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Bookings only carry the contact id: resolve the names of the ones on screen.
  useEffect(() => {
    const missing = [...new Set((items ?? []).map((b) => b.contactId))].filter((id) => !(id in names));
    if (missing.length === 0) return;
    let cancelled = false;
    void Promise.all(
      missing.map((id) =>
        contactBookApi.get(id).then(
          (c) => [id, c.name?.trim() || c.phoneE164] as const,
          () => [id, "Contacto"] as const,
        ),
      ),
    ).then((pairs) => !cancelled && setNames((n) => ({ ...n, ...Object.fromEntries(pairs) })));
    return () => {
      cancelled = true;
    };
  }, [items, names]);

  const replace = (next: Booking) => setItems((list) => list?.map((b) => (b.id === next.id ? next : b)) ?? list);

  async function run(b: Booking, action: Action) {
    if (action === "cancel" && !window.confirm("¿Cancelar esta reserva? El horario quedará libre.")) return;
    try {
      replace(await bookingsApi.transition(b.id, action, { lockVersion: b.lockVersion }));
      setError(null);
    } catch (err) {
      setError(err);
      void load();
    }
  }

  const visible = (items ?? []).filter((b) => showCancelled || b.status !== "cancelled");
  const days = groupByDay(visible, (b) => b.startsAt, (b) => resourceById.get(b.resourceId)?.timezone ?? "UTC");
  const today = todayKey();
  const noSetup = resources.length === 0 || services.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-label="Semana anterior" onClick={() => setMonday(addDays(monday, -7))}>
          <ChevronLeft aria-hidden className="size-4" />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setMonday(mondayOf(todayKey()))}>Esta semana</Button>
        <Button variant="outline" size="sm" aria-label="Semana siguiente" onClick={() => setMonday(addDays(monday, 7))}>
          <ChevronRight aria-hidden className="size-4" />
        </Button>
        <b className="text-sm">{formatDateKey(monday)} – {formatDateKey(addDays(monday, 6))}</b>
        <select aria-label="Filtrar por recurso" value={resourceId} onChange={(e) => setResourceId(e.target.value)} className="ml-auto h-9 rounded-full border-[1.5px] border-ink bg-white px-3 text-sm">
          <option value="">Todos los recursos</option>
          {resources.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-sm">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> Ver canceladas
        </label>
        {canBook ? <Button disabled={noSetup} onClick={() => setCreating(true)}>Nueva reserva</Button> : null}
      </div>

      {error ? <Alert>{bookingErrorMessage(error)}</Alert> : null}

      {noSetup ? (
        <EmptyState title="Configura tu agenda primero">
          Crea al menos un recurso (persona o sala) con su horario semanal y un servicio para poder reservar citas.
        </EmptyState>
      ) : items === null ? (
        <p className="text-muted" aria-busy="true">Cargando reservas…</p>
      ) : days.length === 0 ? (
        <EmptyState title="Sin reservas esta semana">Usa «Nueva reserva» para agendar a un contacto en un horario libre.</EmptyState>
      ) : (
        days.map((day) => (
          <section key={day.date} aria-label={formatDateKey(day.date)}>
            <h2 className="m-0 mb-2 text-[12px] font-bold uppercase text-muted">
              {formatDateKey(day.date)}
              {day.date === today ? " · hoy" : ""}
            </h2>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {day.items.map((b) => {
                const r = resourceById.get(b.resourceId);
                const tz = r?.timezone ?? "UTC";
                const started = Date.parse(b.startsAt) <= Date.now();
                const active = b.status === "pending" || b.status === "confirmed";
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[18px] border border-line bg-white px-4 py-3">
                    <span className="w-28 font-bold">
                      {formatTimeIn(b.startsAt, tz)} – {formatTimeIn(b.endsAt, tz)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <b className="block truncate">{names[b.contactId] ?? "Cargando…"}</b>
                      <span className="text-sm text-muted">
                        {serviceById.get(b.serviceId)?.name ?? "Servicio"} · {r?.name ?? "Recurso"}
                        {b.notes ? ` · ${b.notes}` : ""}
                      </span>
                    </span>
                    <StatusChip label={BOOKING_STATUS_LABELS[b.status]} tone={BOOKING_STATUS_TONES[b.status]} />
                    {canBook && active ? (
                      <span className="flex flex-wrap gap-1.5">
                        {b.status === "pending" ? <Button size="sm" onClick={() => void run(b, "confirm")}>Confirmar</Button> : null}
                        <Button size="sm" variant="outline" onClick={() => setMoving(b)}>Reprogramar</Button>
                        {started ? <Button size="sm" variant="outline" onClick={() => void run(b, "complete")}>Completada</Button> : null}
                        {started ? <Button size="sm" variant="ghost" onClick={() => void run(b, "no-show")}>No asistió</Button> : null}
                        <Button size="sm" variant="ghost" onClick={() => void run(b, "cancel")}>Cancelar</Button>
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {creating ? (
        <NewBookingDialog
          services={services.filter((s) => s.active)}
          resources={resources.filter((r) => r.active)}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            void load();
          }}
        />
      ) : null}
      {moving ? (
        <RescheduleDialog
          booking={moving}
          service={serviceById.get(moving.serviceId)}
          resources={resources.filter((r) => r.active)}
          onClose={() => setMoving(null)}
          onDone={(next) => {
            setMoving(null);
            replace(next);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}
