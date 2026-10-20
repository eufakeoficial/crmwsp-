"use client";

import type { Conversation, Message } from "@crmwsp/contracts";
import { useState } from "react";
import { ConversationItem } from "@/components/inbox/ConversationItem";
import { MessageBubble } from "@/components/inbox/MessageBubble";
import { Button, Modal, Textarea, Toast } from "@/components/ui";
import { useToast } from "@/lib/hooks/use-toast";
import { Row, Section } from "./Section";

const NOW = new Date().toISOString();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const msg = (n: number, over: Partial<Message>): Message => ({
  id: id(n), conversationId: id(900), direction: "outbound", type: "text", body: "Hola, te envío el presupuesto.", status: "queued", author: "user",
  authorUserId: null, clientMessageId: null, error: null, reaction: null, reactionBy: null, sentAt: null, createdAt: NOW, attachments: [], ...over,
});
const conv: Conversation = {
  id: id(901), status: "open", aiMode: "off", channelConnectionId: id(902), contact: { id: id(903), name: "Juan Pérez", phoneE164: "+5491155551234" },
  assignee: { id: id(904), name: "Ana", email: "ana@example.com" }, lastMessage: { id: id(905), direction: "inbound", type: "text", status: "received", preview: "Hola, quiero un presupuesto", createdAt: NOW },
  unreadCount: 2, lastInboundAt: NOW, lastMessageAt: NOW, lastReadAt: null, lockVersion: 0, createdAt: NOW, updatedAt: NOW,
};

export function ShowcaseInbox() {
  const [modal, setModal] = useState(false);
  const { message, show } = useToast();
  return (
    <>
      <Section title="Inbox: burbujas y lista">
        <div className="flex max-w-xl flex-col gap-2 rounded-3xl bg-paper-2 p-4">
          <MessageBubble message={msg(1, { direction: "inbound", status: "received", author: "contact", body: "Hola, quiero un presupuesto" })} />
          <MessageBubble message={msg(2, { status: "queued" })} />
          <MessageBubble message={msg(3, { status: "sent" })} />
          <MessageBubble message={msg(4, { status: "delivered" })} />
          <MessageBubble message={msg(5, { status: "read" })} />
          <MessageBubble message={msg(6, { status: "failed", error: { message: "Invalid API key" } })} />
          <MessageBubble message={msg(7, { direction: "inbound", status: "received", type: "image", body: null })} />
        </div>
        <ul className="m-0 max-w-sm list-none rounded-3xl border border-line bg-white p-2"><ConversationItem conversation={conv} selected={false} onSelect={() => undefined} /></ul>
      </Section>
      <Section title="Diálogo genérico, textarea y toast de aviso">
        <div className="max-w-md"><Textarea aria-label="Ejemplo" rows={2} placeholder="Escribe un mensaje…" /></div>
        <Row><Button variant="outline" onClick={() => setModal(true)}>Abrir diálogo</Button><Button variant="outline" onClick={() => show("Otra persona cambió esta conversación")}>Toast de aviso</Button></Row>
      </Section>
      {modal ? <Modal title="Diálogo de ejemplo" onClose={() => setModal(false)} footer={<Button variant="accent" onClick={() => setModal(false)}>Entendido</Button>}><p className="m-0">Contenido libre con pie de acciones.</p></Modal> : null}
      <Toast message={message} tone="warn" />
    </>
  );
}
