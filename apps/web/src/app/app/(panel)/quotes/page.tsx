import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function Page() {
  return (
    <>
      <PageHeader title="Presupuestos" />
      <EmptyState title="Próximamente" soon>Aquí crearás y enviarás presupuestos con cobro.</EmptyState>
    </>
  );
}
