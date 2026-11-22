"use client";

import type { AiMode, ConversationNote, InboxConversation, Message, ReactionEmoji, TagDto, TenantMember } from "@crmwsp/contracts";
import { type ReactNode, useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { inboxV2Api } from "@/lib/inbox-v2-api";
import { isOutsideServiceWindow } from "@/lib/service-window";
import { Composer } from "./Composer";
import { ConversationHeader, type ReminderInput } from "./ConversationHeader";
import { MessageTimeline } from "./MessageTimeline";

/** Minutes the AI pauses after an agent reply (inbox setting); null = unknown (settings may be admin-only). */
function useAgentReplyPauseMinutes(enabled: boolean): number | null {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    inboxV2Api.settings().then((s) => live && setMinutes(s.pauseAutomationOnAgentReplyMinutes), () => undefined);
    return () => { live = false; };
  }, [enabled]);
  return minutes;
}

export interface ThreadActions {
  onBack: () => void;
  onTogglePanel: () => void;
  onAssign: (assignee: string | null) => void;
  onToggleTag: (name: string, on: boolean) => void;
  onCreateTag: (input: { name: string; emoji: string | null; color: string | null }) => Promise<boolean>;
  onRemind: (input: ReminderInput) => void;
  onToggleStatus: () => void;
  onMarkUnread: () => void;
  onPause: (minutes: number | null) => void;
  onSetAiMode: (mode: AiMode) => void;
}

export function ConversationThread({
  conversationId,
  conversation,
  messages,
  notes,
  members,
  meId,
  tags,
  hasOlder,
  loadingOlder,
  loading,
  blocked,
  busy,
  panelOpen,
  hideSystem,
  error,
  composerSlot,
  actions,
  onHideSystem,
  onSend,
  onSendImage,
  onSendNote,
  onSendTemplate,
  onReact,
  onLoadOlder,
}: {
  conversationId: string;
  conversation: InboxConversation | null;
  messages: readonly Message[];
  notes: readonly ConversationNote[];
  members: readonly TenantMember[] | null;
  meId: string;
  tags: readonly TagDto[];
  hasOlder: boolean;
  loadingOlder: boolean;
  loading: boolean;
  blocked: boolean;
  busy: boolean;
  panelOpen: boolean;
  hideSystem: boolean;
  error: string | undefined;
  /** Rendered above the composer (e.g. `OrderExtractionCard`). */
  composerSlot?: ReactNode;
  actions: ThreadActions;
  onHideSystem: (hide: boolean) => void;
  onSend: (text: string) => Promise<void>;
  onSendImage?: (file: File, caption: string) => Promise<boolean>;
  onSendNote: (text: string) => Promise<boolean>;
  onSendTemplate: (templateId: string, params: string[], clientMessageId: string) => Promise<boolean>;
  onReact: (messageId: string, emoji: ReactionEmoji | null) => Promise<void>;
  onLoadOlder: () => void;
}) {
  const willPause = conversation?.aiMode === "auto";
  const pauseMinutes = useAgentReplyPauseMinutes(willPause);
  const pauseHint = !willPause || pauseMinutes === 0 ? null : pauseMinutes === null ? "Al responder tú, la IA se pausa unos minutos para este cliente" : `Al responder tú, la IA se pausa ${pauseMinutes} minutos para este cliente`;
  return (
    <section aria-label="Conversación" className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
      {conversation ? (
        <ConversationHeader
          conversation={conversation}
          members={members}
          meId={meId}
          tags={tags}
          busy={busy}
          panelOpen={panelOpen}
          hideSystem={hideSystem}
          onHideSystem={onHideSystem}
          {...actions}
        />
      ) : (
        <div className="border-b border-line p-3 text-sm text-muted" aria-busy={loading}>{loading ? "Cargando conversación…" : " "}</div>
      )}
      {error ? <div className="p-3"><Alert>{error}</Alert></div> : null}
      <MessageTimeline conversationId={conversationId} messages={messages} notes={notes} hideSystem={hideSystem} hasOlder={hasOlder} loadingOlder={loadingOlder} onLoadOlder={onLoadOlder} onReact={onReact} />
      {conversation ? (
        <Composer
          key={conversationId}
          blocked={blocked}
          windowWarning={isOutsideServiceWindow(conversation.lastInboundAt)}
          slot={composerSlot}
          onSend={onSend}
          onSendImage={onSendImage}
          onSendNote={onSendNote}
          channelConnectionId={conversation.channelConnectionId}
          onSendTemplate={onSendTemplate}
          pauseHint={pauseHint}
        />
      ) : null}
    </section>
  );
}
