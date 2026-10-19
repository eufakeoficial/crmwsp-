import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function CanalesPage() {
  return (
    <>
      <PageHeader title="Canales" subtitle="Los números de WhatsApp de tu empresa." />
      <EmptyState title="Próximamente" soon>Aquí conectarás tus números de WhatsApp.</EmptyState>
    </>
  );
}
