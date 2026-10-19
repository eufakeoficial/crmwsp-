import { EmptyState, PageHeader } from "@/components/app/EmptyState";

export default function InboxPage() {
  return (
    <>
      <PageHeader title="Inbox" />
      <EmptyState title="Próximamente">Aquí verás tus conversaciones de WhatsApp.</EmptyState>
    </>
  );
}
