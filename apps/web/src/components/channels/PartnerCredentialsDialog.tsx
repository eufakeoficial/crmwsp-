"use client";

import type { Channel } from "@crmwsp/contracts";
import { Modal } from "@/components/ui";
import type { ApiError } from "@/lib/api";
import { PartnerCredentialsPanel } from "./PartnerCredentialsPanel";

/** Modal wrapper kept for the Templates page; the Channels page uses the inline PartnerCredentialsPanel. */
export function PartnerCredentialsDialog({ channel, onClose, onSaved, onNoKeys }: { channel: Channel; onClose: () => void; onSaved: (c: Channel) => void; onNoKeys: (err: ApiError) => void }) {
  return (
    <Modal title="Credenciales de plantillas (Gupshup)" onClose={onClose}>
      <PartnerCredentialsPanel channel={channel} onClose={onClose} onSaved={onSaved} onNoKeys={onNoKeys} />
    </Modal>
  );
}
