"use client";

import type { Order, PaymentLinkResponse, Quote, QuoteActivityEvent, QuoteStatus } from "@crmwsp/contracts";
import { cn } from "@/lib/cn";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { ORDER_STATUS_LABELS } from "@/components/app/orders/order-meta";
import { Alert, Button, CHIP_ROW, Chip, Modal, StatusChip, Toast } from "@/components/ui";
import { formatMoneyMinor } from "@/lib/format";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { ordersApi } from "@/lib/commerce-api";
import { orderPaymentApi, quotesApi } from "@/lib/quotes-api";
import { QuoteEditor } from "./QuoteEditor";
import { QUOTE_STATUS_LABELS, QUOTE_STATUS_ORDER, QUOTE_STATUS_TONES, activityText, availableQuoteActions, contactLabel } from "./quote-meta";

const dateFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium" });
const formatDate = (iso: string): string => dateFmt.format(new Date(iso));
const dateTimeFmt = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });

export function QuotesView() {
  const { tenant } = useSession();
  const role = tenant?.role;
  const canWrite = role === "owner" || role === "admin" || role === "agent";
  const [status, setStatus] = useState<QuoteStatus | "all">("all");
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [editing, setEditing] = useState<{ quote: Quote | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      setQuotes((await quotesApi.list(status === "all" ? undefined : status)).items);
      setError(null);
    } catch (err) {
      setError(err);
      setQuotes([]);
    }
  }, [status]);
  useEffect(() => {
    setQuotes(null);
    void load();
  }, [load]);

  const open = quotes?.find((q) => q.id === openId) ?? null;

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Presupuestos" subtitle="Prepara el precio para un cliente, envíalo por WhatsApp y cobra cuando lo acepte." />
        {canWrite ? (
          <Button onClick={() => setEditing({ quote: null })}><Plus aria-hidden className="size-4" />Nuevo presupuesto</Button>
        ) : null}
      </div>

      <div className={cn(CHIP_ROW, "mb-4")} role="group" aria-label="Filtrar por estado">
        <Chip active={status === "all"} onClick={() => setStatus("all")}>Todos</Chip>
        {QUOTE_STATUS_ORDER.map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{QUOTE_STATUS_LABELS[s]}</Chip>
        ))}
      </div>

      {error ? <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div> : null}

      {quotes === null ? (
        <p className="text-muted" aria-busy="true">Cargando presupuestos…</p>
      ) : quotes.length === 0 && !error ? (
        <EmptyState title="Aún no hay presupuestos" {...(status === "all" ? { action: { href: "/app/contacts", label: "Elegir un contacto" } } : {})}>
          {status === "all" ? "Crea el primero desde un contacto o una conversación y envíalo por WhatsApp." : "No hay presupuestos con este estado."}
        </EmptyState>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {quotes.map((q) => (
            <li key={q.id}>
              <button
                type="button"
                onClick={() => setOpenId(q.id)}
                className="grid w-full cursor-pointer items-center gap-x-4 gap-y-1 rounded-[18px] border border-line bg-white px-4 py-3 text-left text-ink hover:border-ink sm:grid-cols-[110px_1fr_auto_auto]"
              >
                <b>{q.number}</b>
                <span className="min-w-0 truncate">
                  {contactLabel(q)}
                  <span className="ml-2 text-sm text-muted">válido hasta {formatDate(q.validUntil)}</span>
                </span>
                <b>{formatMoneyMinor(q.totalMinor, q.currency)}</b>
                <StatusChip label={QUOTE_STATUS_LABELS[q.status]} tone={QUOTE_STATUS_TONES[q.status]} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <QuoteDetail
          quote={open}
          role={role}
          onClose={() => setOpenId(null)}
          onChanged={() => void load()}
          onEdit={() => setEditing({ quote: open })}
          toast={show}
        />
      ) : null}
      {editing ? (
        <QuoteEditor
          quote={editing.quote}
          onClose={() => setEditing(null)}
          onSaved={(q) => {
            setEditing(null);
            setOpenId(q.id);
            show("Presupuesto guardado");
            void load();
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function QuoteDetail({
  quote,
  role,
  onClose,
  onChanged,
  onEdit,
  toast,
}: {
  quote: Quote;
  role: string | undefined;
  onClose: () => void;
  onChanged: () => void;
  onEdit: () => void;
  toast: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [payLink, setPayLink] = useState<PaymentLinkResponse | null>(null);
  const [confirmLink, setConfirmLink] = useState(false);
  const actions = availableQuoteActions(quote.status, role);

  async function run<T>(fn: () => Promise<T>, after?: (r: T) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      after?.(r);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const copyAcceptLink = () =>
    run(
      () => quotesApi.acceptLink(quote.id),
      async (l) => toast((await copy(l.url)) ? "Enlace copiado" : "No se pudo copiar el enlace"),
    );

  return (
    <Modal
      wide
      title={`${quote.number} · ${contactLabel(quote)}`}
      onClose={onClose}
      footer={
        <>
          <a
            className="inline-flex h-11 items-center rounded-full border-[1.5px] border-ink px-5 text-[14px] font-bold text-ink no-underline"
            href={`/api${quote.pdfUrl ?? `/quotes/${quote.id}/pdf`}`}
            target="_blank"
            rel="noreferrer"
          >
            Ver PDF
          </a>
          {actions.includes("edit") ? <Button variant="outline" disabled={busy} onClick={onEdit}>Editar</Button> : null}
          {actions.includes("submit") ? (
            <Button disabled={busy} onClick={() => void run(() => quotesApi.submit(quote.id), () => toast("Presupuesto enviado a aprobación"))}>
              Preparar para enviar
            </Button>
          ) : null}
          {actions.includes("reject") ? (
            <Button variant="outline" disabled={busy} onClick={() => void run(() => quotesApi.reject(quote.id), () => toast("Presupuesto rechazado"))}>Rechazar</Button>
          ) : null}
          {actions.includes("approve") ? (
            <Button disabled={busy} onClick={() => void run(() => quotesApi.approve(quote.id), () => toast("Presupuesto aprobado"))}>Aprobar</Button>
          ) : null}
          {actions.includes("send") ? (
            <Button variant="whatsapp" disabled={busy} onClick={() => void run(() => quotesApi.send(quote.id), () => toast("Enviando por WhatsApp…"))}>
              Enviar por WhatsApp
            </Button>
          ) : null}
          {actions.includes("link") ? (
            <Button variant="outline" disabled={busy} onClick={() => setConfirmLink(true)}>Copiar enlace de aceptación</Button>
          ) : null}
          {actions.includes("order") ? (
            <Button
              disabled={busy}
              onClick={() => void run(() => quotesApi.convertToOrder(quote.id), (o) => setOrder(o))}
            >
              Pedido y cobro
            </Button>
          ) : null}
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-wrap items-center gap-2">
        <StatusChip label={QUOTE_STATUS_LABELS[quote.status]} tone={QUOTE_STATUS_TONES[quote.status]} />
        <span className="text-sm text-muted">Válido hasta {formatDate(quote.validUntil)}</span>
        {quote.sentAt ? <span className="text-sm text-muted">· enviado {formatDate(quote.sentAt)}</span> : null}
        {quote.acceptedAt ? <span className="text-sm text-muted">· aceptado {formatDate(quote.acceptedAt)}</span> : null}
      </div>
      {quote.status === "pending_approval" ? (
        <Alert>Este presupuesto necesita la aprobación de un propietario o administrador antes de enviarse.</Alert>
      ) : null}

      <ul className="m-0 list-none p-0 text-sm">
        {quote.items.map((i) => (
          <li key={i.id} className="flex justify-between gap-3 border-b border-line py-2">
            <span>
              {i.quantityMilli / 1000} × {i.description}
              {i.discountBp ? <span className="text-muted"> (-{i.discountBp / 100}%)</span> : null}
            </span>
            <b>{formatMoneyMinor(i.lineTotalMinor, quote.currency)}</b>
          </li>
        ))}
      </ul>
      <dl className="m-0 ml-auto grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
        <dt>Subtotal</dt><dd className="m-0 text-right">{formatMoneyMinor(quote.subtotalMinor, quote.currency)}</dd>
        {quote.discountMinor ? <><dt>Descuento</dt><dd className="m-0 text-right">-{formatMoneyMinor(quote.discountMinor, quote.currency)}</dd></> : null}
        <dt>Impuestos</dt><dd className="m-0 text-right">{formatMoneyMinor(quote.taxMinor, quote.currency)}</dd>
        <dt className="font-extrabold">Total</dt><dd className="m-0 text-right font-extrabold">{formatMoneyMinor(quote.totalMinor, quote.currency)}</dd>
      </dl>
      {quote.notes ? <p className="m-0 text-sm text-muted">{quote.notes}</p> : null}

      <ActivityTimeline quoteId={quote.id} version={`${quote.status}:${quote.lockVersion}:${order?.status ?? ""}`} />

      {confirmLink ? (
        <Alert>
          Se generará un enlace nuevo y el que ya recibió el cliente dejará de funcionar.
          <span className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => { setConfirmLink(false); void copyAcceptLink(); }}>Generar y copiar</Button>
            <Button size="sm" variant="outline" onClick={() => setConfirmLink(false)}>Cancelar</Button>
          </span>
        </Alert>
      ) : null}

      {order ? (
        <OrderCollect
          order={order}
          payLink={payLink}
          busy={busy}
          onConfirm={() => void run(() => ordersApi.confirm(order.id), (o) => setOrder(o))}
          onLink={() => void run(() => orderPaymentApi.createLink(order.id), (l) => setPayLink(l))}
          onCopy={async (url) => toast((await copy(url)) ? "Enlace de pago copiado" : "No se pudo copiar el enlace")}
        />
      ) : null}
    </Modal>
  );
}

/** Read-only history built from real records (no separate events table). Reloads when the quote changes. */
function ActivityTimeline({ quoteId, version }: { quoteId: string; version: string }) {
  const [items, setItems] = useState<QuoteActivityEvent[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    quotesApi
      .activity(quoteId)
      .then((r) => {
        if (!alive) return;
        setItems(r.items);
        setFailed(false);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [quoteId, version]);
  return (
    <section aria-label="Historial de actividad" className="rounded-2xl border border-line p-3">
      <h3 className="m-0 mb-2 text-sm font-extrabold">Historial de actividad</h3>
      {failed ? (
        <p className="m-0 text-sm text-muted">No se pudo cargar el historial.</p>
      ) : items === null ? (
        <p className="m-0 text-sm text-muted" aria-busy="true">Cargando historial…</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1.5 p-0 text-sm">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-x-3">
              <span>{activityText(e)}</span>
              <time dateTime={e.at} className="text-muted">{dateTimeFmt.format(new Date(e.at))}</time>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Order created from the accepted quote. Payment is only ever confirmed by the provider webhook. */
function OrderCollect({
  order,
  payLink,
  busy,
  onConfirm,
  onLink,
  onCopy,
}: {
  order: Order;
  payLink: PaymentLinkResponse | null;
  busy: boolean;
  onConfirm: () => void;
  onLink: () => void;
  onCopy: (url: string) => void;
}) {
  return (
    <section className="rounded-2xl bg-paper p-3" aria-label="Pedido">
      <p className="m-0 flex flex-wrap items-center gap-2">
        <b>Pedido {order.number}</b>
        <span className="text-sm text-muted">{ORDER_STATUS_LABELS[order.status]}</span>
        <Link href={`/app/orders/${order.id}`} className="text-sm underline">Abrir pedido</Link>
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {order.status === "draft" ? <Button size="sm" disabled={busy} onClick={onConfirm}>Confirmar pedido</Button> : null}
        {order.status === "pending_payment" && !payLink ? (
          <Button size="sm" disabled={busy} onClick={onLink}>Generar enlace de pago</Button>
        ) : null}
        {payLink ? (
          <>
            <a className="text-sm underline" href={payLink.url} target="_blank" rel="noreferrer">Abrir enlace de pago</a>
            <Button size="sm" variant="outline" onClick={() => onCopy(payLink.url)}>Copiar enlace de pago</Button>
          </>
        ) : null}
        {order.status === "paid" ? <span className="text-sm">Pago verificado.</span> : null}
      </div>
      {order.status === "pending_payment" ? (
        <p className="m-0 mt-2 text-xs text-muted">El pedido pasa a pagado solo cuando el proveedor confirma el pago.</p>
      ) : null}
    </section>
  );
}
