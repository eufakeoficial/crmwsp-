"use client";

import { InboxView } from "@/components/inbox/InboxView";
import { PendingOrderExtractions } from "@/components/inbox/PendingOrderExtractions";

export default function InboxPage() {
  return <InboxView composerSlot={(conversation) => <PendingOrderExtractions conversation={conversation} />} />;
}
