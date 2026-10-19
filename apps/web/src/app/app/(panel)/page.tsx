import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function HomePage() {
  return (
    <>
      <PageHeader title="Inicio" subtitle="El resumen de tu negocio en WhatsApp." />
      <EmptyState title="Próximamente" soon>Aquí verás tus métricas y tareas del día.</EmptyState>
    </>
  );
}
