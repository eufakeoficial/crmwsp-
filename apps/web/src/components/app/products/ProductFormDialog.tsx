"use client";

import type { Product } from "@crmwsp/contracts";
import { type FormEvent, useId, useState } from "react";
import { Alert, Button, Input, Label, Modal, Textarea } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { productsApi } from "@/lib/commerce-api";
import { currencyDecimals, majorToMinor, minorToMajor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { KIND_LABELS, STATUS_LABELS, optionsLabel } from "./product-meta";

const SELECT = "block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px] text-ink";

function saveErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code === "CONFLICT") return "Ese SKU ya está en uso.";
  return errorMessage(err);
}

/** Create (product = null) or edit a product; stock is edited per variant through PUT /products/:id/variants. */
export function ProductFormDialog({
  product,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  product: Product | null;
  defaultCurrency: string;
  onClose: () => void;
  onSaved: (p: Product) => void;
}) {
  const formId = useId();
  const editing = product !== null;
  const [name, setName] = useState(product?.name ?? "");
  const [sku, setSku] = useState(product?.sku ?? "");
  const [kind, setKind] = useState<Product["kind"]>(product?.kind ?? "physical");
  const [status, setStatus] = useState<Product["status"]>(product?.status ?? "active");
  const [currency, setCurrency] = useState(product?.currency ?? defaultCurrency);
  const [price, setPrice] = useState(product ? String(minorToMajor(product.priceMinor, product.currency)) : "");
  const [taxPct, setTaxPct] = useState(product ? String(product.taxRateBp / 100) : "0");
  const [category, setCategory] = useState(product?.category ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [trackStock, setTrackStock] = useState(product?.trackStock ?? true);
  const [newStock, setNewStock] = useState("0");
  const [stocks, setStocks] = useState<Record<string, string>>(
    Object.fromEntries((product?.variants ?? []).map((v) => [v.id, String(v.stockOnHand)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cur = currency.trim().toUpperCase();
    const priceMinor = majorToMinor(price.replace(",", "."), cur);
    const taxRateBp = Math.round(Number(taxPct.replace(",", ".")) * 100);
    if (!name.trim()) return setError("El nombre es obligatorio.");
    if (!/^[A-Z]{3}$/.test(cur)) return setError("La moneda debe ser un código de 3 letras (por ejemplo EUR).");
    if (priceMinor === undefined) return setError(`Precio no válido (máximo ${currencyDecimals(cur)} decimales).`);
    if (!Number.isInteger(taxRateBp) || taxRateBp < 0 || taxRateBp > 10_000) return setError("El impuesto debe estar entre 0 y 100 %.");

    const stockUpdates = product
      ? product.variants
          .map((v) => ({ id: v.id, value: Number(stocks[v.id]), was: v.stockOnHand }))
          .filter((s) => Number.isInteger(s.value) && s.value >= 0 && s.value !== s.was)
      : [];
    if (Object.values(stocks).some((s) => !/^\d+$/.test(s)) || (!editing && !/^\d+$/.test(newStock))) {
      return setError("El stock debe ser un número entero mayor o igual que 0.");
    }

    setBusy(true);
    setError(undefined);
    try {
      let saved: Product;
      if (product) {
        saved = await productsApi.patch(product.id, {
          name: name.trim(),
          sku: sku.trim() || null,
          kind,
          status,
          currency: cur,
          priceMinor,
          taxRateBp,
          category: category.trim() || null,
          description: description.trim() || null,
          trackStock,
        });
        if (stockUpdates.length) {
          saved = await productsApi.putVariants(product.id, { variants: stockUpdates.map((s) => ({ id: s.id, stockOnHand: s.value })) });
        }
      } else {
        saved = await productsApi.create({
          name: name.trim(),
          ...(sku.trim() ? { sku: sku.trim() } : {}),
          kind,
          status,
          currency: cur,
          priceMinor,
          taxRateBp,
          tags: [],
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          trackStock,
          ...(trackStock ? { variants: [{ options: {}, stockOnHand: Number(newStock) }] } : {}),
        });
      }
      onSaved(saved);
    } catch (err) {
      setError(saveErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, control: React.ReactNode) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${formId}-${id}`}>{label}</Label>
      {control}
    </div>
  );

  return (
    <Modal
      wide
      title={editing ? "Editar producto" : "Nuevo producto"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="submit" form={formId} variant="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" noValidate>
        {field("name", "Nombre", <Input id={`${formId}-name`} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-autofocus />)}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("sku", "SKU (opcional)", <Input id={`${formId}-sku`} value={sku} onChange={(e) => setSku(e.target.value)} maxLength={100} />)}
          {field("category", "Categoría", <Input id={`${formId}-category`} value={category} onChange={(e) => setCategory(e.target.value)} maxLength={100} />)}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {field("price", "Precio", <Input id={`${formId}-price`} inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" />)}
          {field("currency", "Moneda", <Input id={`${formId}-currency`} value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} />)}
          {field("tax", "Impuesto (%)", <Input id={`${formId}-tax`} inputMode="decimal" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} />)}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {field(
            "kind",
            "Tipo",
            <select id={`${formId}-kind`} className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as Product["kind"])}>
              {(Object.keys(KIND_LABELS) as Product["kind"][]).map((k) => (
                <option key={k} value={k}>{KIND_LABELS[k]}</option>
              ))}
            </select>,
          )}
          {field(
            "status",
            "Estado",
            <select id={`${formId}-status`} className={SELECT} value={status} onChange={(e) => setStatus(e.target.value as Product["status"])}>
              {(Object.keys(STATUS_LABELS) as Product["status"][]).map((s) => (
                <option key={s} value={s}>{STATUS_LABELS[s]}</option>
              ))}
            </select>,
          )}
        </div>
        {field("description", "Descripción", <Textarea id={`${formId}-description`} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />)}
        <label className="flex items-center gap-2 text-sm font-bold">
          <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
          Controlar stock
        </label>
        {trackStock && !editing
          ? field("stock", "Stock inicial", <Input id={`${formId}-stock`} inputMode="numeric" value={newStock} onChange={(e) => setNewStock(e.target.value)} />)
          : null}
        {trackStock && product ? (
          <fieldset className="m-0 flex flex-col gap-2 rounded-2xl border border-line p-3">
            <legend className="px-1 text-sm font-bold">Stock en mano por variante</legend>
            {product.variants.map((v) => (
              <div key={v.id} className="grid grid-cols-[1fr_110px] items-center gap-2">
                <Label htmlFor={`${formId}-st-${v.id}`} className="font-normal">{optionsLabel(v.options)}</Label>
                <Input
                  id={`${formId}-st-${v.id}`}
                  inputMode="numeric"
                  value={stocks[v.id] ?? ""}
                  onChange={(e) => setStocks((s) => ({ ...s, [v.id]: e.target.value }))}
                  className="h-10"
                />
              </div>
            ))}
          </fieldset>
        ) : null}
        <Alert>{error}</Alert>
      </form>
    </Modal>
  );
}
