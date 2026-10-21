"use client";

import type { Contact, ContactPanel as ContactPanelDto, InboxConversation, TagDto } from "@crmwsp/contracts";
import { Bot, CalendarDays, Clock, Compass, MoreVertical, Phone, Plus, X } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ContactActivity } from "@/components/contacts/ContactActivity";
import { Avatar, Badge } from "@/components/ui";
import { extractedRows } from "@/lib/contact-extracted";
import { formatDate, formatDateTime } from "@/lib/format";
import { localTimeIn, originLabel } from "./inbox-meta";
import { MenuItem, Popover } from "./Popover";

function InfoRow({ icon: Icon, label, children }: { icon: typeof Clock; label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 py-1.5 text-sm">
      <Icon aria-hidden className="mt-0.5 size-4 flex-none text-muted" />
      <span className="sr-only">{label}: </span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line px-4 py-3">
      <h3 className="m-0 text-[12px] font-extrabold tracking-wide text-muted uppercase">{title}</h3>
      {children}
    </section>
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
    <aside aria-label="Ficha del contacto" className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-white">
      <div className="flex items-center gap-1 px-4 py-2.5">
        <b className="min-w-0 flex-1 truncate text-[15px]">{title}</b>
        <Popover
          label="Más acciones del contacto"
          align="right"
          triggerClassName="size-9 min-w-9 bg-transparent p-0 hover:bg-paper"
          trigger={<MoreVertical aria-hidden className="size-[18px]" />}
        >
          {(close) => (
            <div className="flex flex-col">
              <MenuItem onClick={() => { void navigator.clipboard?.writeText(summary.phoneE164).catch(() => undefined); close(); }}>Copiar teléfono</MenuItem>
              <MenuItem disabled={busy} onClick={() => { onPause(paused ? null : 1440); close(); }}>
                {paused ? "Reanudar automatizaciones" : "Pausar automatizaciones 24 h"}
              </MenuItem>
            </div>
          )}
        </Popover>
        <button type="button" onClick={onClose} aria-label="Cerrar ficha del contacto" title="Cerrar" className="grid size-9 flex-none cursor-pointer place-items-center rounded-full bg-transparent text-ink hover:bg-paper">
          <X aria-hidden className="size-[18px]" />
        </button>
      </div>

      <div className="flex flex-col items-center gap-3 px-4 pb-4">
        <Avatar name={summary.name ?? "?"} className="size-[120px] rounded-lg text-4xl" />
        <div className="w-full">
          <InfoRow icon={Compass} label="Origen del lead">
            {conversation.inboxStatus === "closed" ? "Cerrado" : "Abierto"} · {panel ? originLabel(panel) : "…"}
          </InfoRow>
          <InfoRow icon={Clock} label="Hora local">
            {panel?.timezone ? `${localTime ?? ""}${localTime ? " · " : ""}${panel.timezone}` : panel ? "Zona horaria desconocida" : "…"}
          </InfoRow>
          <InfoRow icon={Phone} label="Teléfono">{summary.phoneE164}</InfoRow>
          <InfoRow icon={CalendarDays} label="Primer contacto">{panel ? formatDate(panel.firstContactAt) : "…"}</InfoRow>
        </div>
        <Link href="/app/contacts" className="flex h-9 w-full items-center justify-center rounded-lg border border-line-2 bg-white text-[13px] font-bold text-ink no-underline hover:bg-paper">
          Historial completo
        </Link>
      </div>

      <Section title="Automatizaciones">
        <button
          type="button"
          disabled={busy}
          onClick={() => onPause(paused ? null : 1440)}
          className="flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-line-2 bg-white px-3 text-[13px] font-bold text-ink hover:bg-paper disabled:opacity-50"
        >
          <Bot aria-hidden className="size-4" />
          {paused ? "Reanudar automatizaciones" : "Pausar automatizaciones"}
        </button>
        {paused && pausedUntil ? <p className="m-0 text-xs text-warning">Pausadas hasta {formatDateTime(pausedUntil)}</p> : null}
      </Section>

      <Section title="Etiquetas">
        <div className="flex flex-wrap items-center gap-1.5">
          {contactTags.length ? (
            contactTags.map((t) => (
              <Badge key={t.name}>
                <span aria-hidden>{t.emoji ?? "🏷"}</span> {t.name}
                <button type="button" aria-label={`Quitar etiqueta ${t.name}`} disabled={busy} onClick={() => onToggleTag(t.name, false)} className="ml-1 cursor-pointer bg-transparent p-0 font-bold">×</button>
              </Badge>
            ))
          ) : (
            <span className="text-sm text-muted">Sin etiquetas</span>
          )}
          <Popover label="Añadir etiqueta" align="right" triggerClassName="h-7 min-w-7 border border-line-2 bg-white text-[12px] hover:bg-paper" trigger={<><Plus aria-hidden className="size-3.5" /> Añadir</>}>
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
      </Section>

      <Section title="Campos">
        {rows.length ? (
          <dl className="m-0 flex flex-col gap-1 text-sm" data-testid="extracted-fields">
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
          <p className="m-0 text-sm text-muted">{contact ? "Sin datos" : "…"}</p>
        )}
      </Section>

      <Section title="Oportunidades">
        <div className="text-sm [&>span]:items-start">
          <ContactActivity contactId={summary.id} />
        </div>
      </Section>
    </aside>
  );
}
