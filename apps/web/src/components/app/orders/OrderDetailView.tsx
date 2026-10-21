"use client";

import type { Order } from "@crmwsp/contracts";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, ReasonDialog, Toast } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { ordersApi } from "@/lib/commerce-api";
import { formatMoneyMinor } from "@/lib/format";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { OrderStatusChip } from "./OrderStatusChip";
import {
  ACTION_LABELS,
  FULFILLMENT_LABELS,
  availableActions,
  formatDateTime,
  optionsText,
  paymentLabel,
  type OrderActionKey,
} from "./order-meta";

function orderErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "INSUFFICIENT_STOCK") return "No hay stock suficiente para confirmar este pedido.";
    if (err.code === "NOT_FOUND") return "El pedido no existe.";
    if (err.code === "CONFLICT") return "El pedido cambió de estado. Recarga la página.";
  }
  return errorMessage(err);
}

export function OrderDetailView({ id }: { id: string }) {
  const { tenant } = useSession();
  const canMarkPaid = tenant?.role === "owner" || tenant?.role === "admin";
  const canAct = tenant?.role !== "viewer";
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [paying, setPaying] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      setOrder(await ordersApi.get(id));
      setError(null);
    } catch (err) {
      setError(err);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(fn: () => Promise<Order>, ok: string) {
    setBusy(true);
    try {
      setOrder(await fn());
      setError(null);
      show(ok);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  function perform(action: OrderActionKey) {
    switch (action) {
      case "mark_paid":
        setPaying(true);
        return;
      case "cancel":
        setCancelling(true);
        return;
      case "confirm":
        void run(() => ordersApi.confirm(id), "Pedido confirmado");
        return;
      case "fulfill":
        void run(() => ordersApi.fulfill(id), "Pedido preparado");
        return;
      case "ship":
        void run(() => ordersApi.ship(id), "Pedido enviado");
        return;
      case "deliver":
        void run(() => ordersApi.deliver(id), "Pedido entregado");
        return;
    }
  }

  const back = (
    <Link href="/app/orders" className="mb-3 inline-flex items-center gap-1.5 text-sm font-bold text-ink no-underline hover:underline">
      <ArrowLeft aria-hidden className="size-4" />Pedidos
    </Link>
  );

  if (!order) {
    return (
      <>
        {back}
        {error ? <Alert>{orderErrorMessage(error)}</Alert> : <p className="text-muted" aria-busy="true">Cargando pedido…</p>}
      </>
    );
  }

  const actions = availableActions(order.status, order.fulfillment).filter((a) => canAct && (a !== "mark_paid" || canMarkPaid));
  const address = order.shippingAddress;
  const addressLines = address
    ? ["name", "line1", "line2", "city", "region", "postalCode", "country", "phone"]
        .map((k) => address[k])
        .filter((v): v is string => typeof v === "string" && v !== "")
    : [];

  return (
    <>
      {back}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={`Pedido ${order.number}`}
          subtitle={`Creado el ${formatDateTime(order.createdAt)}${order.createdByType === "ai" ? " por la IA" : ""}`}
        />
        <OrderStatusChip status={order.status} />
      </div>
      {error ? <div className="mb-4"><Alert>{orderErrorMessage(error)}</Alert></div> : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="p-4 sm:p-6">
          <h2 className="mt-0 text-lg">Productos</h2>
          <ul className="m-0 flex list-none flex-col p-0">
            {order.items.map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 border-b border-paper py-2.5">
                <div className="min-w-0">
                  <b>{i.description}</b>
                  {Object.keys(i.options).length ? <div className="text-sm text-muted">{optionsText(i.options)}</div> : null}
                  <div className="text-sm text-muted">{i.quantity} × {formatMoneyMinor(i.unitPriceMinor, order.currency)}</div>
                </div>
                <b className="whitespace-nowrap">{formatMoneyMinor(i.lineTotalMinor, order.currency)}</b>
              </li>
            ))}
          </ul>
          <dl className="mt-4 ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-sm">
            <dt>Subtotal</dt>
            <dd className="m-0 text-right">{formatMoneyMinor(order.subtotalMinor, order.currency)}</dd>
            {order.discountMinor > 0 ? (
              <>
                <dt>Descuento</dt>
                <dd className="m-0 text-right">-{formatMoneyMinor(order.discountMinor, order.currency)}</dd>
              </>
            ) : null}
            <dt>Envío</dt>
            <dd className="m-0 text-right">{formatMoneyMinor(order.shippingMinor, order.currency)}</dd>
            <dt>Impuestos</dt>
            <dd className="m-0 text-right">{formatMoneyMinor(order.taxMinor, order.currency)}</dd>
            <dt className="text-base font-extrabold">Total</dt>
            <dd className="m-0 text-right text-base font-extrabold">{formatMoneyMinor(order.totalMinor, order.currency)}</dd>
          </dl>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4 sm:p-6">
            <h2 className="mt-0 text-lg">Cliente</h2>
            <p className="m-0"><b>{order.contact.name?.trim() || "Sin nombre"}</b></p>
            <p className="m-0 text-sm text-muted">{order.contact.phoneE164}</p>
            <h2 className="mt-4 mb-1 text-lg">Pago y entrega</h2>
            <p className="m-0 text-sm">
              Pago: <b>{paymentLabel(order)}</b>
              {order.paidAt ? ` (${formatDateTime(order.paidAt)})` : ""}
            </p>
            <p className="m-0 text-sm">Entrega: <b>{FULFILLMENT_LABELS[order.fulfillment]}</b></p>
            {addressLines.length ? <p className="mt-1 mb-0 text-sm text-muted">{addressLines.join(", ")}</p> : null}
            {order.notes ? <p className="mt-2 mb-0 text-sm">Notas: {order.notes}</p> : null}
          </Card>
          {actions.length ? (
            <Card className="flex flex-col gap-2 p-4 sm:p-6">
              <h2 className="mt-0 mb-1 text-lg">Acciones</h2>
              {actions.map((a) => (
                <Button key={a} variant={a === "cancel" ? "outline" : "primary"} disabled={busy} onClick={() => perform(a)}>
                  {ACTION_LABELS[a]}
                </Button>
              ))}
            </Card>
          ) : null}
        </div>
      </div>

      {paying ? (
        <ReasonDialog
          title="Marcar como pagado"
          description="Pago manual: queda registrado en la auditoría con tu motivo."
          fieldLabel="Motivo del pago manual (obligatorio)"
          confirmLabel="Marcar pagado"
          onCancel={() => setPaying(false)}
          onConfirm={(reason) => {
            setPaying(false);
            void run(() => ordersApi.markPaid(id, reason), "Pago registrado");
          }}
        />
      ) : null}
      {cancelling ? (
        <ReasonDialog
          title="Cancelar pedido"
          description="Se liberará el stock reservado. Esta acción no se puede deshacer."
          confirmLabel="Cancelar pedido"
          onCancel={() => setCancelling(false)}
          onConfirm={() => {
            setCancelling(false);
            void run(() => ordersApi.cancel(id), "Pedido cancelado");
          }}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}
