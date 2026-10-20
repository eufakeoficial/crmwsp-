"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { contactBookApi } from "@/lib/contacts-api";

/** Open orders/quotes of a contact, for the inbox side panel. Fails soft to a dash. */
export function ContactActivity({ contactId }: { contactId: string | undefined }) {
  const [counts, setCounts] = useState<{ orders: number; quotes: number } | "error" | null>(null);

  useEffect(() => {
    if (!contactId) return;
    let cancelled = false;
    setCounts(null);
    contactBookApi.get(contactId).then(
      (d) => !cancelled && setCounts({ orders: d.openOrdersCount, quotes: d.openQuotesCount }),
      () => !cancelled && setCounts("error"),
    );
    return () => {
      cancelled = true;
    };
  }, [contactId]);

  if (!contactId || counts === null) return <span className="font-normal text-muted">…</span>;
  if (counts === "error") return <span className="font-normal text-muted">—</span>;
  return (
    <span className="flex flex-col items-end gap-0.5 font-normal">
      <Link href="/app/orders" className="underline">{counts.orders} {counts.orders === 1 ? "pedido abierto" : "pedidos abiertos"}</Link>
      <Link href="/app/quotes" className="underline">{counts.quotes} {counts.quotes === 1 ? "presupuesto abierto" : "presupuestos abiertos"}</Link>
    </span>
  );
}
