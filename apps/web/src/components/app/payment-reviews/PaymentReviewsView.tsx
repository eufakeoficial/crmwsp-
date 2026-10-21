"use client";

import type { PaymentReview, PaymentReviewStatus } from "@crmwsp/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Button, Card, Chip, ReasonDialog } from "@/components/ui";
import { formatDateTime, formatMoneyMinor } from "@/lib/format";
import { attachmentsApi } from "@/lib/inbox-api";
import { errorMessage } from "@/lib/messages";
import { paymentReviewsApi } from "@/lib/payment-reviews-api";

const STATUS_LABELS: Record<PaymentReviewStatus, string> = {
  pending: "Pendientes",
  approved: "Aprobados",
  rejected: "Rechazados",
};

function ReceiptImage({ review }: { review: PaymentReview }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const attachmentId = review.attachmentId;
  useEffect(() => {
    setUrl(null);
    setFailed(false);
  }, [attachmentId]);
  const load = () => {
    // Media is fetched on demand: only attachments already in storage have a signed URL.
    if (!attachmentId) return;
    attachmentsApi.url(attachmentId).then((r) => setUrl(r.url), () => setFailed(true));
  };
  if (!attachmentId || failed) {
    return (
      <Link href={`/app/inbox?conversation=${review.conversationId}`} className="text-sm underline">
        Ver comprobante en la conversación
      </Link>
    );
  }
  if (!url) {
    return (
      <Button variant="outline" size="sm" onClick={load}>
        Mostrar imagen
      </Button>
    );
  }
  return <img src={url} alt="Comprobante enviado por el cliente" className="max-h-80 w-full rounded-xl border border-line object-contain" />;
}

function ExtractedData({ review }: { review: PaymentReview }) {
  const e = review.extracted;
  if (review.extraction === "unsupported") {
    return <p className="m-0 text-sm text-muted">La IA conectada no lee imágenes: verifica el comprobante manualmente.</p>;
  }
  if (review.extraction === "failed") {
    return <p className="m-0 text-sm text-muted">No se pudo leer el comprobante: verifica manualmente.</p>;
  }
  return (
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="text-muted">Monto leído</dt>
      <dd className="m-0 font-semibold">
        {e.amountMinor !== null ? formatMoneyMinor(e.amountMinor, e.currency ?? review.order.currency) : "—"}
      </dd>
      <dt className="text-muted">Total del pedido</dt>
      <dd className="m-0">{formatMoneyMinor(review.order.totalMinor, review.order.currency)}</dd>
      <dt className="text-muted">Fecha</dt>
      <dd className="m-0">{e.date ?? "—"}</dd>
      <dt className="text-muted">Referencia</dt>
      <dd className="m-0 break-all">{e.reference ?? "—"}</dd>
      <dt className="text-muted">Confianza IA</dt>
      <dd className="m-0">{e.confidence !== null ? `${Math.round(e.confidence * 100)} %` : "—"}</dd>
    </dl>
  );
}

export function PaymentReviewsView() {
  const [status, setStatus] = useState<PaymentReviewStatus>("pending");
  const [items, setItems] = useState<PaymentReview[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<PaymentReview | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    try {
      const res = await paymentReviewsApi.list(status);
      setItems(res.items);
      setError(null);
    } catch (err) {
      setError(err);
      setItems([]);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, fn: () => Promise<PaymentReview>) => {
    setBusy(id);
    try {
      await fn();
      setError(null);
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Comprobantes de pago"
        subtitle="Revisa los comprobantes de pago que envían tus clientes. La IA los lee, pero solo una persona confirma el pago."
      />
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Estado">
        {(Object.keys(STATUS_LABELS) as PaymentReviewStatus[]).map((s) => (
          <Chip key={s} active={s === status} onClick={() => setStatus(s)}>
            {STATUS_LABELS[s]}
          </Chip>
        ))}
      </div>
      <Alert>{error ? errorMessage(error) : null}</Alert>
      {items === null ? <p className="text-muted">Cargando…</p> : null}
      {items?.length === 0 ? <EmptyState title="No hay comprobantes en este estado" /> : null}
      <div className="grid gap-4 lg:grid-cols-2">
        {items?.map((r) => (
          <Card key={r.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Link href={`/app/orders/${r.order.id}`} className="font-bold underline">
                Pedido {r.order.number}
              </Link>
              <span className="text-sm text-muted">{formatDateTime(r.createdAt)}</span>
            </div>
            <p className="m-0 text-sm">{r.contact.name?.trim() || r.contact.phoneE164 || "Cliente"}</p>
            <ReceiptImage review={r} />
            <ExtractedData review={r} />
            {r.extraction === "extracted" ? (
              r.amountMatches ? (
                <p className="m-0 text-sm font-semibold">El monto leído coincide con el total del pedido.</p>
              ) : (
                <p className="m-0 text-sm font-semibold">Atención: el monto leído no coincide con el total del pedido.</p>
              )
            ) : null}
            {r.status === "rejected" && r.rejectReason ? <p className="m-0 text-sm text-muted">Motivo: {r.rejectReason}</p> : null}
            {r.status === "pending" ? (
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy === r.id} onClick={() => void act(r.id, () => paymentReviewsApi.approve(r.id))}>
                  Aprobar y marcar pagado
                </Button>
                <Button variant="outline" disabled={busy === r.id} onClick={() => setRejecting(r)}>
                  Rechazar
                </Button>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      {rejecting ? (
        <ReasonDialog
          title={`Rechazar comprobante del pedido ${rejecting.order.number}`}
          description="El cliente recibirá un mensaje amable pidiendo verificar el pago (si la ventana de 24 h está abierta)."
          confirmLabel="Rechazar"
          onCancel={() => setRejecting(null)}
          onConfirm={(reason) => {
            const r = rejecting;
            setRejecting(null);
            void act(r.id, () => paymentReviewsApi.reject(r.id, reason));
          }}
        />
      ) : null}
    </div>
  );
}
