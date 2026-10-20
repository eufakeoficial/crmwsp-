import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { PaymentsPage } from "@/components/platform/PaymentsPage";
import { PlatformDashboard } from "@/components/platform/PlatformDashboard";
import { PlatformSettingsPage } from "@/components/platform/PlatformSettingsPage";
import { TenantDetail } from "@/components/platform/TenantDetail";
import { TenantsList } from "@/components/platform/TenantsList";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AdminPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug ?? [];
  const [section, id] = slug;
  if (!section) return <PlatformDashboard />;
  if (section === "tenants" && slug.length === 1) return <TenantsList />;
  if (section === "tenants" && slug.length === 2 && id && UUID_RE.test(id)) return <TenantDetail id={id} />;
  if (section === "approvals" && slug.length === 1) return <TenantsList mode="approvals" />;
  if (section === "payments" && slug.length === 1) return <PaymentsPage />;
  if (section === "settings" && slug.length === 1) return <PlatformSettingsPage />;
  return (
    <>
      <PageHeader title="Backoffice" subtitle="Administración de la plataforma CRMWSP." />
      <EmptyState title="Próximamente" soon>
        Esta sección del backoffice se construirá en una fase posterior.
      </EmptyState>
    </>
  );
}
