"use client";

import type { Product } from "@crmwsp/contracts";
import { cn } from "@/lib/cn";
import { Pencil, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, CHIP_ROW, Chip, SearchInput, StatusChip, Toast, type Tone } from "@/components/ui";
import { productsApi } from "@/lib/commerce-api";
import { defaultCurrency, useCurrencySettings } from "@/lib/currency-api";
import { formatMoneyMinor } from "@/lib/format";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { ProductFormDialog } from "./ProductFormDialog";
import { KIND_LABELS, STATUS_LABELS, optionsLabel } from "./product-meta";

type StatusFilter = Product["status"] | "all";
const STATUS_TONE: Record<Product["status"], Tone> = { draft: "paper", active: "success", archived: "danger" };

export function ProductsView() {
  const { tenant } = useSession();
  const canManage = tenant?.role === "owner" || tenant?.role === "admin";
  const [products, setProducts] = useState<Product[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const currencySettings = useCurrencySettings();
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [editing, setEditing] = useState<Product | "new" | null>(null);
  const { message, show } = useToast();

  const statusParam = status === "all" ? undefined : status;
  const load = useCallback(async () => {
    setProducts(null);
    try {
      const page = await productsApi.list({ q: query || undefined, status: statusParam, limit: 50 });
      setProducts(page.items);
      setCursor(page.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
      setProducts([]);
      setCursor(null);
    }
  }, [query, statusParam]);
  useEffect(() => {
    void load();
  }, [load]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await productsApi.list({ q: query || undefined, status: statusParam, limit: 50, cursor });
      setProducts((list) => [...(list ?? []), ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      setError(err);
    } finally {
      setLoadingMore(false);
    }
  }

  function onSaved(p: Product) {
    setProducts((list) => {
      const rest = list ?? [];
      return rest.some((x) => x.id === p.id) ? rest.map((x) => (x.id === p.id ? p : x)) : [p, ...rest];
    });
    setEditing(null);
    show("Producto guardado");
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Productos" subtitle="Lo que vendes, con precios y stock. La IA usa este catálogo para responder y cotizar." />
        {canManage ? (
          <Button variant="accent" onClick={() => setEditing("new")}>
            <Plus aria-hidden className="size-5" />Nuevo producto
          </Button>
        ) : null}
      </div>

      <form
        className="mb-3 max-w-md"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          setQuery(draftQuery.trim());
        }}
      >
        <SearchInput label="Buscar productos" placeholder="Nombre, SKU o categoría" value={draftQuery} onChange={(e) => setDraftQuery(e.target.value)} />
      </form>
      <div className={cn(CHIP_ROW, "mb-4")} role="group" aria-label="Filtrar por estado">
        <Chip active={status === "all"} onClick={() => setStatus("all")}>Activos y borradores</Chip>
        {(["active", "draft", "archived"] as const).map((s) => (
          <Chip key={s} active={status === s} onClick={() => setStatus(s)}>{STATUS_LABELS[s]}</Chip>
        ))}
      </div>

      {error ? <div className="mb-4"><Alert>{errorMessage(error)}</Alert></div> : null}

      {products === null ? (
        <p className="text-muted" aria-busy="true">Cargando productos…</p>
      ) : products.length === 0 && !error ? (
        <EmptyState title="Aún no hay productos">
          {canManage ? "Primer paso: crea tu primer producto o servicio con el botón de arriba." : "Pide a un administrador que cree el catálogo."}
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {products.map((p) => (
            <Card key={p.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <b className="text-lg">{p.name}</b>
                  <div className="text-sm text-muted">
                    {p.sku} · {KIND_LABELS[p.kind]}{p.category ? ` · ${p.category}` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <b>{formatMoneyMinor(p.priceMinor, p.currency)}</b>
                  <StatusChip label={STATUS_LABELS[p.status]} tone={STATUS_TONE[p.status]} />
                  {canManage ? (
                    <Button variant="outline" size="sm" onClick={() => setEditing(p)} aria-label={`Editar ${p.name}`}>
                      <Pencil aria-hidden className="size-4" />Editar
                    </Button>
                  ) : null}
                </div>
              </div>
              <ul className="m-0 mt-3 flex list-none flex-col gap-1 p-0 text-sm">
                {p.variants.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-paper pt-1.5">
                    <span className={v.isActive ? "" : "text-muted line-through"}>
                      {optionsLabel(v.options)}{v.sku ? ` · ${v.sku}` : ""}
                      {v.priceMinor !== null ? ` · ${formatMoneyMinor(v.priceMinor, p.currency)}` : ""}
                    </span>
                    <span className="text-muted">
                      {p.trackStock ? `Stock ${v.stockAvailable} (en mano ${v.stockOnHand}, reservado ${v.stockReserved})` : "Sin control de stock"}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      {cursor ? (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore ? "Cargando…" : "Cargar más"}
          </Button>
        </div>
      ) : null}

      {editing ? (
        <ProductFormDialog
          product={editing === "new" ? null : editing}
          defaultCurrency={defaultCurrency(currencySettings, products?.[0]?.currency ?? "EUR")}
          currencies={currencySettings}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      ) : null}
      <Toast message={message} />
    </>
  );
}
