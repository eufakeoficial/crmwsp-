"use client";

import type { Conversation, ConversationStatus, Message, TenantMember } from "@crmwsp/contracts";
import { isOutsideServiceWindow } from "@/lib/service-window";
import { Alert } from "@/components/ui";
import { Composer } from "./Composer";
import { ConversationHeader } from "./ConversationHeader";
import { MessageTimeline } from "./MessageTimeline";

export function ConversationThread({
  conversationId,
  conversation,
  messages,
  members,
  meId,
  hasOlder,
  loadingOlder,
  loading,
  blocked,
  busy,
  error,
  onBack,
  onInfo,
  onAssign,
  onStatus,
  onSend,
  onSendTemplate,
  onLoadOlder,
}: {
  conversationId: string;
  conversation: Conversation | null;
  messages: readonly Message[];
  members: readonly TenantMember[] | null;
  meId: string;
  hasOlder: boolean;
  loadingOlder: boolean;
  loading: boolean;
  blocked: boolean;
  busy: boolean;
  error: string | undefined;
  onBack: () => void;
  onInfo: () => void;
  onAssign: (userId: string | null) => void;
  onStatus: (s: ConversationStatus) => void;
  onSend: (text: string) => Promise<void>;
  onSendTemplate: (templateId: string, params: string[], clientMessageId: string) => Promise<boolean>;
  onLoadOlder: () => void;
}) {
  return (
    <section aria-label="Conversación" className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[22px] border border-line bg-white">
      {conversation ? (
        <ConversationHeader
          conversation={conversation}
          members={members}
          meId={meId}
          busy={busy}
          onBack={onBack}
          onInfo={onInfo}
          onAssign={onAssign}
          onStatus={onStatus}
        />
      ) : (
        <div className="border-b border-line p-3 text-sm text-muted" aria-busy={loading}>{loading ? "Cargando conversación…" : " "}</div>
      )}
      {error ? <div className="p-3"><Alert>{error}</Alert></div> : null}
      <MessageTimeline conversationId={conversationId} messages={messages} hasOlder={hasOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} />
      {conversation ? (
        <Composer
          key={conversationId}
          blocked={blocked}
          windowWarning={isOutsideServiceWindow(conversation.lastInboundAt)}
          onSend={onSend}
          channelConnectionId={conversation.channelConnectionId}
          onSendTemplate={onSendTemplate}
        />
      ) : null}
    </section>
  );
}
