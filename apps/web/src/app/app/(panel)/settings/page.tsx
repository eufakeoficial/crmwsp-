import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function Page() {
  return (
    <>
      <PageHeader title="Configuración" />
      <EmptyState title="Próximamente" soon>Aquí ajustarás tu empresa y tus preferencias.</EmptyState>
    </>
  );
}
