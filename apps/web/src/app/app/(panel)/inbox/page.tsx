import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" subtitle="Tus conversaciones de WhatsApp." />
      <EmptyState title="Próximamente" soon>Aquí verás tus conversaciones de WhatsApp.</EmptyState>
    </>
  );
}
