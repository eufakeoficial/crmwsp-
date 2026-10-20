"use client";

import type { Order } from "@crmwsp/contracts";
import { Columns3, List } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { Alert, Button, Chip } from "@/components/ui";
import { ordersApi } from "@/lib/commerce-api";
import { formatMoneyMinor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { OrderStatusChip } from "./OrderStatusChip";
import { FULFILLMENT_LABELS, ORDER_STATUS_LABELS, ORDER_STATUS_ORDER, formatDateTime, type OrderStatus } from "./order-meta";

type ViewMode = "list" | "board";

const contactLabel = (o: Order): string => o.contact.name?.trim() || o.contact.phoneE164;

export function OrdersView() {
  const [mode, setMode] = useState<ViewMode>("list");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  // The board always shows every status; only the list uses the status filter.
  const filter = mode === "list" && status !== "all" ? status : undefined;
  const limit = mode === "board" ? 100 : 25;

  const load = useCallback(async () => {
    setOrders(null);
    try {
      const page = await ordersApi.list({ status: filter, limit });
      setOrders(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
      setOrders([]);
      setCursor(null);
    }
  }, [filter, limit]);
  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await ordersApi.list({ status: filter, limit, cursor });
      setOrders((list) => [...(list ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Pedidos" subtitle="Seguimiento de pedidos, pagos y entregas." />
        <div className="flex gap-1.5" role="group" aria-label="Vista">
          <Chip active={mode === "list"} onClick={() => setMode("list")}>
            <List aria-hidden className="mr-1.5 size-4" />Lista
          </Chip>
          <Chip active={mode === "board"} onClick={() => setMode("board")}>
            <Columns3 aria-hidden className="mr-1.5 size-4" />Tablero
          </Chip>
        </div>
      </div>

      {mode === "list" ? (
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Filtrar por estado">
          <Chip active={status === "all"} onClick={() => setStatus("all")}>Todos</Chip>
          {ORDER_STATUS_ORDER.map((s) => (
            <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{ORDER_STATUS_LABELS[s]}</Chip>
          ))}
        </div>
      ) : null}

      {error ? <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div> : null}

      {orders === null ? (
        <p className="text-muted" aria-busy="true">Cargando pedidos…</p>
      ) : orders.length === 0 && !error ? (
        <EmptyState title="Aún no hay pedidos">
          {status === "all" || mode === "board" ? "Los pedidos creados por tu equipo o por la IA aparecerán aquí." : "No hay pedidos con este estado."}
        </EmptyState>
      ) : mode === "list" ? (
        <OrdersList orders={orders} />
      ) : (
        <OrdersBoard orders={orders} />
      )}

      {cursor ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function OrdersList({ orders }: { orders: Order[] }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/app/orders/${o.id}`}
            className="grid items-center gap-x-4 gap-y-1 rounded-[18px] border border-line bg-white px-4 py-3 text-ink no-underline hover:border-ink sm:grid-cols-[110px_1fr_auto_auto]"
          >
            <b>{o.number}</b>
            <span className="min-w-0 truncate">
              {contactLabel(o)}
              <span className="ml-2 text-sm text-muted">{FULFILLMENT_LABELS[o.fulfillment]} · {formatDateTime(o.createdAt)}</span>
            </span>
            <b>{formatMoneyMinor(o.totalMinor, o.currency)}</b>
            <OrderStatusChip status={o.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function OrdersBoard({ orders }: { orders: Order[] }) {
  const byStatus = useMemo(() => {
    const map = new Map<OrderStatus, Order[]>(ORDER_STATUS_ORDER.map((s) => [s, []]));
    for (const o of orders) map.get(o.status)?.push(o);
    return map;
  }, [orders]);
  return (
    <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
      {ORDER_STATUS_ORDER.map((s) => {
        const col = byStatus.get(s) ?? [];
        return (
          <section key={s} aria-label={ORDER_STATUS_LABELS[s]} className="flex w-[260px] flex-none flex-col gap-2 rounded-[18px] bg-paper p-3">
            <h2 className="m-0 flex items-center justify-between text-sm font-extrabold">
              {ORDER_STATUS_LABELS[s]}
              <span className="text-muted">{col.length}</span>
            </h2>
            {col.length === 0 ? <p className="m-0 text-sm text-muted">Sin pedidos</p> : null}
            {col.map((o) => (
              <Link key={o.id} href={`/app/orders/${o.id}`} className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white p-3 text-ink no-underline hover:border-ink">
                <b>{o.number}</b>
                <span className="truncate text-sm">{contactLabel(o)}</span>
                <span className="text-sm text-muted">{formatMoneyMinor(o.totalMinor, o.currency)}</span>
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}
