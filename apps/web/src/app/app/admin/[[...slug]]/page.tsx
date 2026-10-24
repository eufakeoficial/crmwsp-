import { notFound } from "next/navigation";
import { AuditPage } from "@/components/platform/AuditPage";
import { CannedResponsesPage } from "@/components/platform/CannedResponsesPage";
import { SupportInbox } from "@/components/platform/SupportInbox";
import { EmailInbox } from "@/components/platform/EmailInbox";
import { ChannelsPage } from "@/components/platform/ChannelsPage";
import { PaymentsPage } from "@/components/platform/PaymentsPage";
import { PlansPage } from "@/components/platform/PlansPage";
import { PlatformDashboard } from "@/components/platform/PlatformDashboard";
import { PlatformSettingsPage } from "@/components/platform/PlatformSettingsPage";
import { TenantDetail } from "@/components/platform/TenantDetail";
import { TenantsList } from "@/components/platform/TenantsList";
import { UsagePage } from "@/components/platform/UsagePage";
import { UsersPage } from "@/components/platform/UsersPage";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One-segment sections of the backoffice; anything else is a real 404. */
const SECTIONS: Record<string, () => React.JSX.Element> = {
  tenants: () => <TenantsList />,
  approvals: () => <TenantsList mode="approvals" />,
  users: () => <UsersPage />,
  channels: () => <ChannelsPage />,
  payments: () => <PaymentsPage />,
  plans: () => <PlansPage />,
  usage: () => <UsagePage />,
  support: () => <SupportInbox />,
  email: () => <EmailInbox />,
  canned: () => <CannedResponsesPage />,
  audit: () => <AuditPage />,
  settings: () => <PlatformSettingsPage />,
};

export default async function AdminPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug ?? [];
  const [section, id] = slug;
  if (!section) return <PlatformDashboard />;
  if (section === "tenants" && slug.length === 2 && id && UUID_RE.test(id)) return <TenantDetail id={id} />;
  const render = slug.length === 1 && Object.hasOwn(SECTIONS, section) ? SECTIONS[section] : undefined;
  if (!render) notFound();
  return render();
}
