"use client";

import type { BookingResource, BookingService } from "@crmwsp/contracts";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { canBook, canManageAgenda } from "@/components/app/roles";
import { Alert, Tabs } from "@/components/ui";
import { bookingsApi } from "@/lib/bookings-api";
import { errorMessage } from "@/lib/messages";
import { BookingsPanel } from "./BookingsPanel";
import { ResourcesPanel } from "./ResourcesPanel";
import { ServicesPanel } from "./ServicesPanel";

/** Agenda: bookings calendar plus the setup it needs (services, resources with hours and time off). */
export function AgendaView() {
  const { tenant } = useSession();
  const [resources, setResources] = useState<BookingResource[] | null>(null);
  const [services, setServices] = useState<BookingService[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([bookingsApi.resources(), bookingsApi.services()]);
      setResources(r.items);
      setServices(s.items);
      setError(null);
    } catch (err) {
      setError(err);
      setResources((r) => r ?? []);
      setServices((s) => s ?? []);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const manage = canManageAgenda(tenant?.role);

  return (
    <>
      <PageHeader title="Agenda" subtitle="Reserva citas para tus contactos en horarios libres: define servicios y recursos, y gestiona las reservas de la semana." />
      {error ? <div className="mb-3"><Alert>{errorMessage(error)}</Alert></div> : null}
      {resources === null || services === null ? (
        <p className="text-muted" aria-busy="true">Cargando agenda…</p>
      ) : (
        <Tabs
          label="Secciones de la agenda"
          items={[
            { id: "calendar", label: "Reservas", content: <div className="pt-4"><BookingsPanel services={services} resources={resources} canBook={canBook(tenant?.role)} /></div> },
            { id: "services", label: "Servicios", content: <div className="pt-4"><ServicesPanel services={services} canManage={manage} onChanged={() => void load()} /></div> },
            { id: "resources", label: "Recursos y horarios", content: <div className="pt-4"><ResourcesPanel resources={resources} canManage={manage} onChanged={() => void load()} /></div> },
          ]}
        />
      )}
    </>
  );
}
