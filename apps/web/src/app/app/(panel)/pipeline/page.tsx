import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function Page() {
  return (
    <>
      <PageHeader title="Pipeline" />
      <EmptyState title="Próximamente" soon>Aquí moverás tus oportunidades por etapas.</EmptyState>
    </>
  );
}
