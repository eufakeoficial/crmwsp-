"use client";

import { Bell, Gauge, Lightbulb, Search as SearchIcon, Sparkles, Users, Wallet } from "lucide-react";
import { useState } from "react";
import { LogoMark } from "@/components/brand/Logo";
import { SidebarLink } from "@/components/app/AppSidebar";
import {
  Accordion, AssistantFab, Avatar, BackButton, Badge, Banner, Breadcrumbs, Button, Chip, DateBlock, KpiCard,
  LeadCard, PillSelect, SearchInput, SectionHero, Spinner, StatusChip, Tabs, buttonClasses,
} from "@/components/ui";
import { formatDate, formatMoney, formatRelative } from "@/lib/format";
import { Row, Section } from "./Section";

const FAQ = [
  { question: "¿Cómo se confirma un pago?", answer: "Solo por webhook o conciliación, nunca por una imagen." },
  { question: "¿Puedo tener varias empresas?", answer: "Sí, con el selector de empresa de la barra superior." },
];

export function ShowcaseBasics() {
  const [chip, setChip] = useState("Todos");
  const [city, setCity] = useState("Ciudad A");
  const date = new Date("2026-10-19T12:00:00Z");
  return (
    <>
      <Section title="Marca y navegación">
        <Row label="Logo">
          <LogoMark />
          <span className="rounded-[20px] bg-ink p-3"><div className="w-56 rounded-full"><SidebarLink item={{ key: "i", label: "Inbox", href: "/app/inbox", icon: Gauge }} active={false} count={3} /></div></span>
          <span className="rounded-[20px] bg-ink p-3"><div className="w-56"><SidebarLink item={{ key: "h", label: "Inicio", href: "/app", icon: Gauge }} active /></div></span>
        </Row>
        <Breadcrumbs items={[{ label: "Inicio", href: "/app" }, { label: "Presupuestos", href: "/app/quotes" }, { label: "P-0042" }]} />
        <Row><BackButton href="/app" /><BackButton onClick={() => undefined} tone="white" /><Spinner /></Row>
      </Section>

      <Section title="Botones">
        <Row>
          <Button variant="primary">Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="whatsapp">WhatsApp</Button>
          <Button disabled>Deshabilitado</Button>
          <a href="/app" className={buttonClasses("accent", "", "sm")}>Enlace como botón</a>
        </Row>
      </Section>

      <Section title="Badges, chips y avatares">
        <Row label="Badge"><Badge tone="verified">Verificado</Badge><Badge tone="new">Nuevo</Badge><Badge>Neutral</Badge></Row>
        <Row label="Estados"><StatusChip label="Enviada" /><StatusChip label="Pidió cambios" /><StatusChip label="Vencida" /><StatusChip label="Borrador" /><StatusChip label="Aprobada" /></Row>
        <Row label="Chips (filtro)">
          {["Todos", "Abiertos", "Cerrados"].map((c) => <Chip key={c} active={chip === c} onClick={() => setChip(c)}>{c}</Chip>)}
          <PillSelect label="Ciudad" options={["Ciudad A", "Ciudad B", "Ciudad C"]} value={city} onChange={setCity} />
        </Row>
        <Row label="Avatares"><Avatar name="Nombre Apellido" /><Avatar name="Nombre Apellido" tone="ink" /><Avatar name="Nombre Apellido" tone="lime" round size="lg" /><Avatar name="Empresa Demo" tone="paper" size="sm" /></Row>
        <Row label="DateBlock"><DateBlock date={date} /><span className="text-sm text-muted">{formatDate(date)} · {formatMoney(1250.5, "USD")} · {formatRelative(new Date(Date.now() - 3_600_000))}</span></Row>
      </Section>

      <Section title="Búsqueda, tabs y acordeón">
        <form onSubmit={(e) => e.preventDefault()} className="max-w-md"><SearchInput placeholder="Buscar contactos…" /></form>
        <Tabs label="Ejemplo" items={[{ id: "a", label: "Resumen", content: <p className="m-0 text-muted">Contenido de Resumen.</p> }, { id: "b", label: "Actividad", content: <p className="m-0 text-muted">Contenido de Actividad.</p> }, { id: "c", label: "Notas", content: <p className="m-0 text-muted">Contenido de Notas.</p> }]} />
        <div className="max-w-xl rounded-[22px] bg-white px-6 py-2"><Accordion items={FAQ} /></div>
      </Section>

      <Section title="Banners, tarjetas y hero">
        <Banner tone="lime" icon={Lightbulb}>Responde en menos de 5 minutos y cierras el doble de ventas.</Banner>
        <Banner tone="info" icon={Bell}>Tu canal de WhatsApp está en revisión.</Banner>
        <div className="grid gap-4 sm:grid-cols-2">
          <LeadCard title="Cliente Demo A" subtitle="Pidió presupuesto · hace 2 h" badge={<Badge tone="new">Nuevo</Badge>} fields={[{ label: "Servicio", value: "Instalación" }, { label: "Monto est.", value: formatMoney(3200, "USD") }, { label: "Ciudad", value: "Ciudad A" }, { label: "Canal", value: "WhatsApp" }]} actions={<><Button size="sm">Responder</Button><Button size="sm" variant="outline">Ver ficha</Button></>} />
          <div className="grid gap-3">
            <KpiCard label="Conversaciones" value="128" icon={Users} tone="info" />
            <KpiCard label="Cobrado este mes" value={formatMoney(18450, "USD")} icon={Wallet} tone="success" />
            <KpiCard label="Pendientes" value="7" icon={SearchIcon} tone="warning" />
          </div>
        </div>
        <SectionHero icon={Sparkles} eyebrow="Presupuestos" title="Presupuestos y cobros" subtitle="Crea, envía y cobra desde WhatsApp." actions={<Button variant="accent" size="sm">Nuevo presupuesto</Button>} />
        <div className="relative h-24"><AssistantFab /></div>
      </Section>
    </>
  );
}
