"use client";

import type { ContactBookDetail, ContactBookDoc, ContactBookItem } from "@crmwsp/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Alert, Badge, Button, Input, SidePanel, Switch } from "@/components/ui";
import type { PanelField } from "@/components/ui";
import { contactBookApi } from "@/lib/contacts-api";
import { formatMoneyMinor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { CONSENT_LABELS, formatWhen, parseTags } from "./contact-meta";

function DocList({ docs, href, empty }: { docs: ContactBookDoc[]; href: (d: ContactBookDoc) => string; empty: string }) {
  if (docs.length === 0) return <span className="font-normal text-muted">{empty}</span>;
  return (
    <ul className="m-0 flex list-none flex-col items-end gap-1 p-0 font-normal">
      {docs.map((d) => (
        <li key={d.id}>
          <Link href={href(d)} className="underline">{d.number}</Link>
          <span className="text-muted"> · {formatMoneyMinor(d.totalMinor, d.currency)} · {d.status}</span>
        </li>
      ))}
    </ul>
  );
}

export function ContactDrawer({
  contactId,
  onClose,
  onChanged,
}: {
  contactId: string;
  onClose: () => void;
  onChanged: (next: ContactBookItem) => void;
}) {
  const [detail, setDetail] = useState<ContactBookDetail | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    contactBookApi.get(contactId).then(
      (d) => {
        if (cancelled) return;
        setDetail(d);
        setTagsDraft(d.tags.join(", "));
      },
      (err) => !cancelled && setError(err),
    );
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  function apply(next: ContactBookItem) {
    setDetail((d) => (d ? { ...d, ...next } : d));
    setTagsDraft(next.tags.join(", "));
    onChanged(next);
  }

  async function run(fn: () => Promise<ContactBookItem>) {
    setBusy(true);
    setError(null);
    try {
      apply(await fn());
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const title = detail ? detail.name?.trim() || detail.phoneE164 : "Contacto";
  const fields: PanelField[] = detail
    ? [
        { label: "Teléfono", value: detail.phoneE164 },
        { label: "Cliente desde", value: formatWhen(detail.createdAt) },
        { label: "Último mensaje", value: formatWhen(detail.lastMessageAt) },
        {
          label: "Conversación",
          value: detail.conversationId ? (
            <Link href={`/app/inbox?conversation=${detail.conversationId}`} className="underline">Abrir en la bandeja</Link>
          ) : (
            <span className="font-normal text-muted">Sin conversación</span>
          ),
        },
        {
          label: "Marketing",
          value: (
            <span className="flex flex-col items-end gap-1">
              <Switch
                label="Acepta mensajes de marketing"
                checked={detail.marketingConsent === "granted"}
                onChange={(granted) => {
                  if (!busy) void run(() => contactBookApi.setMarketingConsent(detail.id, granted));
                }}
              />
              <span className="text-xs font-normal text-muted">{CONSENT_LABELS[detail.marketingConsent]}</span>
            </span>
          ),
        },
        {
          label: "Etiquetas",
          value: (
            <form
              className="flex w-full max-w-[260px] flex-col items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => contactBookApi.setTags(detail.id, parseTags(tagsDraft)));
              }}
            >
              <span className="flex flex-wrap justify-end gap-1">
                {detail.tags.length ? detail.tags.map((t) => <Badge key={t}>{t}</Badge>) : <span className="font-normal text-muted">Sin etiquetas</span>}
              </span>
              <Input
                aria-label="Etiquetas separadas por coma"
                placeholder="vip, mayorista"
                value={tagsDraft}
                onChange={(e) => setTagsDraft(e.target.value)}
              />
              <Button type="submit" variant="outline" disabled={busy}>Guardar etiquetas</Button>
            </form>
          ),
        },
        {
          label: `Pedidos (${detail.openOrdersCount} abiertos)`,
          value: <DocList docs={detail.orders} href={(d) => `/app/orders/${d.id}`} empty="Sin pedidos" />,
        },
        {
          label: `Presupuestos (${detail.openQuotesCount} abiertos)`,
          value: <DocList docs={detail.quotes} href={() => "/app/quotes"} empty="Sin presupuestos" />,
        },
      ]
    : [{ label: "Estado", value: error ? "No se pudo cargar" : "Cargando…" }];

  return (
    <SidePanel
      title={title}
      fields={fields}
      onClose={onClose}
      actions={error ? <Alert>{errorMessage(error)}</Alert> : undefined}
    />
  );
}
