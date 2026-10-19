import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function Page() {
  return (
    <>
      <PageHeader title="Contactos" />
      <EmptyState title="Próximamente" soon>Aquí gestionarás tus clientes y su historial.</EmptyState>
    </>
  );
}
