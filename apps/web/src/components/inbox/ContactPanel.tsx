"use client";

import type { Contact, ContactPanel as ContactPanelDto, InboxConversation, TagDto } from "@crmwsp/contracts";
import { ArrowLeft, Bot, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { ContactActivity } from "@/components/contacts/ContactActivity";
import { Avatar, Badge, Card } from "@/components/ui";
import { extractedRows } from "@/lib/contact-extracted";
import { formatDate, formatDateTime } from "@/lib/format";
import { localTimeIn, originLabel } from "./inbox-meta";
import { MenuItem, Popover } from "./Popover";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-paper py-1.5 text-sm last:border-0">
      <span className="flex-none text-muted">{label}</span>
      <b className="min-w-0 text-right break-words">{children}</b>
    </div>
  );
}

/** Fourth column: contact data, lead origin, automations pause, tags, extracted fields and open sales. */
export function ContactPanel({
  conversation,
  contact,
  panel,
  tags,
  busy,
  onToggleTag,
  onPause,
  onClose,
}: {
  conversation: InboxConversation;
  contact: Contact | null;
  panel: ContactPanelDto | null;
  tags: readonly TagDto[];
  busy: boolean;
  onToggleTag: (name: string, on: boolean) => void;
  /** minutes = null resumes automations now. */
  onPause: (minutes: number | null) => void;
  /** Mobile: back to the thread. */
  onClose: () => void;
}) {
  const summary = conversation.contact;
  const title = summary.name ?? "Contacto desconocido";
  const pausedUntil = panel?.automationsPausedUntil ?? conversation.automationsPausedUntil;
  const paused = pausedUntil !== null && new Date(pausedUntil) > new Date();
  const rows = extractedRows(contact?.extracted);
  const localTime = localTimeIn(panel?.timezone ?? null);
  const contactTags = panel?.tags ?? conversation.contactTags.map((name) => ({ name, emoji: null, color: null }));
  const current = new Set(conversation.contactTags);
  return (
    <aside aria-label="Ficha del contacto" className="flex min-h-0 flex-col overflow-y-auto">
      <Card className="flex flex-col gap-3 p-4 sm:p-4">
        <button type="button" onClick={onClose} aria-label="Volver a la conversación" className="grid size-9 cursor-pointer place-items-center self-start rounded-full bg-paper text-ink desk:hidden">
          <ArrowLeft aria-hidden className="size-5" />
        </button>
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar name={summary.name ?? "?"} size="lg" round />
          <b className="text-[17px]">{title}</b>
          <span className="text-sm text-muted">{summary.phoneE164}</span>
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => onPause(paused ? null : 1440)}
          className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border-[1.5px] border-ink bg-white px-3 text-[13px] font-bold text-ink hover:bg-paper disabled:opacity-50"
        >
          <Bot aria-hidden className="size-4" />
          {paused ? "Reanudar automatizaciones" : "Pausar automatizaciones"}
        </button>
        {paused && pausedUntil ? <p className="m-0 text-center text-xs text-warning">Pausadas hasta {formatDateTime(pausedUntil)}</p> : null}

        <div>
          <Row label="Origen del lead">{panel ? originLabel(panel) : "…"}</Row>
          <Row label="Zona horaria">{panel?.timezone ? `${panel.timezone}${localTime ? ` · ${localTime}` : ""}` : panel ? "Desconocida" : "…"}</Row>
          <Row label="Primer contacto">{panel ? formatDate(panel.firstContactAt) : "…"}</Row>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted">Etiquetas</span>
            <Popover label="Añadir etiqueta" align="right" triggerClassName="h-7 min-w-7 text-[12px]" trigger={<><Plus aria-hidden className="size-3.5" /> Añadir</>}>
              {(close) => (
                <div className="flex flex-col">
                  {tags.filter((t) => !current.has(t.name)).map((t) => (
                    <MenuItem key={t.id} onClick={() => { onToggleTag(t.name, true); close(); }}>
                      <span aria-hidden>{t.emoji ?? "🏷"}</span> {t.name}
                    </MenuItem>
                  ))}
                  {tags.every((t) => current.has(t.name)) ? <p className="m-0 p-2 text-xs text-muted">No hay más etiquetas.</p> : null}
                </div>
              )}
            </Popover>
          </div>
          {contactTags.length ? (
            <span className="flex flex-wrap gap-1">
              {contactTags.map((t) => (
                <Badge key={t.name}>
                  <span aria-hidden>{t.emoji ?? "🏷"}</span> {t.name}
                  <button type="button" aria-label={`Quitar etiqueta ${t.name}`} disabled={busy} onClick={() => onToggleTag(t.name, false)} className="ml-1 cursor-pointer bg-transparent p-0 font-bold">×</button>
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-sm font-bold">Sin etiquetas</span>
          )}
        </div>

        <div>
          <span className="text-sm text-muted">Campos personalizados</span>
          {rows.length ? (
            <dl className="m-0 mt-1 flex flex-col gap-0.5 text-sm" data-testid="extracted-fields">
              {rows.map((r) => (
                <div key={r.key} className="flex flex-wrap justify-between gap-1 break-all">
                  <dt className="font-normal text-muted">{r.key}</dt>
                  <dd className="m-0 font-bold">
                    {r.value}
                    {r.confidence !== null ? <span className="font-normal text-muted"> ({r.confidence}%)</span> : null}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="m-0 mt-1 text-sm font-bold">{contact ? "Sin datos" : "…"}</p>
          )}
        </div>

        <Row label="Oportunidades">
          <ContactActivity contactId={summary.id} />
        </Row>
      </Card>
    </aside>
  );
}
