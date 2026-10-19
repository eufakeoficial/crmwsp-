import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { assertAdminPreviewEnabled } from "@/lib/admin-preview";

export default function AdminPage() {
  assertAdminPreviewEnabled();
  return (
    <>
      <PageHeader title="Backoffice" subtitle="Administración de la plataforma CRMWSP." />
      <EmptyState title="Próximamente" soon>El backoffice del SaaS se construirá en una fase posterior.</EmptyState>
    </>
  );
}
