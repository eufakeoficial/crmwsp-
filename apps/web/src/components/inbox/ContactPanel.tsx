import type { Contact } from "@crmwsp/contracts";
import type { ReactNode } from "react";
import { Avatar, Badge, Card } from "@/components/ui";
import type { PanelField } from "@/components/ui";
import { extractedRows } from "@/lib/contact-extracted";

/** Rows shown in the contact card (desktop column) and in the mobile SidePanel. */
export function contactFields(summary: { name: string | null; phoneE164: string }, contact: Contact | null): PanelField[] {
  const tags: ReactNode = contact?.tags.length ? (
    <span className="flex flex-wrap justify-end gap-1">
      {contact.tags.map((t) => <Badge key={t}>{t}</Badge>)}
    </span>
  ) : (
    "Sin etiquetas"
  );
  const rows = extractedRows(contact?.extracted);
  const extracted: ReactNode = rows.length ? (
    <dl className="m-0 flex flex-col items-end gap-0.5" data-testid="extracted-fields">
      {rows.map((r) => (
        <div key={r.key} className="flex flex-wrap justify-end gap-1 break-all">
          <dt className="font-normal text-muted">{r.key}:</dt>
          <dd className="m-0">
            {r.value}
            {r.confidence !== null ? <span className="font-normal text-muted"> ({r.confidence}%)</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <span className="font-normal text-muted">{contact ? "Sin datos" : "…"}</span>
  );
  return [
    { label: "Nombre", value: summary.name ?? "Sin nombre" },
    { label: "Teléfono", value: summary.phoneE164 },
    { label: "Etiquetas", value: tags },
    { label: "Datos extraídos", value: extracted },
    { label: "Oportunidades", value: <span className="font-normal text-muted">próximamente</span> },
  ];
}

export function ContactPanel({ summary, contact }: { summary: { name: string | null; phoneE164: string }; contact: Contact | null }) {
  return (
    <aside aria-label="Ficha del contacto" className="hidden min-h-0 overflow-y-auto desk:block">
      <Card className="flex flex-col gap-3 p-4 sm:p-4">
        <div className="flex flex-col items-center gap-2 text-center">
          <Avatar name={summary.name ?? summary.phoneE164} size="lg" round />
          <b className="text-[17px]">{summary.name ?? summary.phoneE164}</b>
        </div>
        {contactFields(summary, contact).map((f) => (
          <div key={f.label} className="flex justify-between gap-3 border-b border-paper py-1.5 text-sm last:border-0">
            <span className="text-muted">{f.label}</span>
            <b className="text-right">{f.value}</b>
          </div>
        ))}
      </Card>
    </aside>
  );
}
