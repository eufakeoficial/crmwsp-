"use client";

import type { Contact, ProductSearchItem, Quote, QuoteItemInput } from "@crmwsp/contracts";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Alert, Button, Input, Label, Modal, Textarea } from "@/components/ui";
import { contactsApi } from "@/lib/inbox-api";
import { currencyDecimals, formatMoneyMinor, majorToMinor } from "@/lib/format";
import { errorMessage } from "@/lib/messages";
import { catalogSearchApi, quotesApi } from "@/lib/quotes-api";
import { contactLabel, datePlusDays } from "./quote-meta";
import { currencyOptions, useCurrencySettings } from "@/lib/currency-api";

interface Line {
  key: number;
  /** Catalog line (variant) or free line. */
  item: ProductSearchItem | null;
  description: string;
  quantity: string;
  /** Free lines: unit price typed in major units. */
  price: string;
  discountPct: string;
}

let lineKey = 0;
const newLine = (item: ProductSearchItem | null): Line => ({
  key: ++lineKey,
  item,
  description: item ? `${item.name}${item.variant ? ` (${[item.variant.size, item.variant.color].filter(Boolean).join(" / ")})` : ""}` : "",
  quantity: "1",
  price: "",
  discountPct: "",
});

function parseQuantityMilli(s: string): number | undefined {
  const m = /^(\d+)(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return undefined;
  const v = Number(m[1]) * 1000 + Number((m[2] ?? "").padEnd(3, "0"));
  return v >= 1 && v <= 1_000_000 ? v : undefined;
}

function toInput(l: Line, currency: string): QuoteItemInput | string {
  const quantityMilli = parseQuantityMilli(l.quantity);
  if (quantityMilli === undefined) return "Revisa las cantidades (hasta 3 decimales).";
  let discountBp: number | undefined;
  if (l.discountPct.trim() !== "") {
    const pct = Number(l.discountPct.replace(",", "."));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "El descuento debe estar entre 0 y 100.";
    discountBp = Math.round(pct * 100);
  }
  const base = { quantityMilli, ...(discountBp ? { discountBp } : {}) };
  if (l.item) return { ...base, productId: l.item.id, variantId: l.item.variantId };
  const price = majorToMinor(l.price, currency);
  if (!l.description.trim() || price === undefined) return "Las líneas libres necesitan descripción y un precio válido.";
  return { ...base, description: l.description.trim(), unitPriceMinor: price };
}

/** Create a draft or edit an existing one. Totals are always computed by the server on save. */
export function QuoteEditor({ quote, onClose, onSaved }: { quote: Quote | null; onClose: () => void; onSaved: (q: Quote) => void }) {
  const [contact, setContact] = useState<{ id: string; label: string } | null>(quote ? { id: quote.contact.id, label: contactLabel(quote) } : null);
  const [contactQuery, setContactQuery] = useState("");
  const [contactResults, setContactResults] = useState<Contact[]>([]);
  const currencySettings = useCurrencySettings();
  const [currency, setCurrency] = useState(quote?.currency ?? "EUR");
  // New quotes default to the tenant base currency once it loads.
  useEffect(() => {
    if (!quote && currencySettings) setCurrency(currencySettings.base);
  }, [quote, currencySettings]);
  const [validUntil, setValidUntil] = useState(quote ? quote.validUntil.slice(0, 10) : datePlusDays(15));
  const [notes, setNotes] = useState(quote?.notes ?? "");
  const [terms, setTerms] = useState(quote?.terms ?? "");
  // Existing lines cannot be resent faithfully (variants are not echoed), so they are kept unless replaced.
  const [replaceLines, setReplaceLines] = useState(quote === null);
  const [lines, setLines] = useState<Line[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [productResults, setProductResults] = useState<ProductSearchItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function searchContacts() {
    try {
      setContactResults((await contactsApi.list({ q: contactQuery.trim() || undefined, limit: 8 })).items);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function searchProducts() {
    try {
      setProductResults((await catalogSearchApi.search(productQuery.trim())).items.filter((p) => p.currency === currency));
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  const patchLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  async function save() {
    setError(null);
    if (!contact) return setError("Elige un contacto.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return setError("Indica la fecha de validez.");
    let items: QuoteItemInput[] | undefined;
    if (replaceLines) {
      if (lines.length === 0) return setError("Añade al menos una línea.");
      items = [];
      for (const l of lines) {
        const r = toInput(l, currency);
        if (typeof r === "string") return setError(r);
        items.push(r);
      }
    }
    setBusy(true);
    try {
      const saved = quote
        ? await quotesApi.patch(quote.id, {
            lockVersion: quote.lockVersion,
            contactId: contact.id,
            currency,
            validUntil,
            notes: notes.trim() || null,
            terms: terms.trim() || null,
            ...(items ? { items } : {}),
          })
        : await quotesApi.create({
            contactId: contact.id,
            currency,
            validUntil,
            items: items ?? [],
            ...(notes.trim() ? { notes: notes.trim() } : {}),
            ...(terms.trim() ? { terms: terms.trim() } : {}),
          });
      onSaved(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const decimals = currencyDecimals(currency);
  return (
    <Modal
      wide
      title={quote ? `Editar ${quote.number}` : "Nuevo presupuesto"}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button disabled={busy} onClick={() => void save()}>{busy ? "Guardando…" : "Guardar borrador"}</Button>
        </>
      }
    >
      {error ? <Alert>{error}</Alert> : null}

      <div>
        <Label htmlFor="q-contact">Contacto</Label>
        {contact ? (
          <p className="m-0 mt-1 flex items-center gap-2">
            <b>{contact.label}</b>
            <Button size="sm" variant="ghost" onClick={() => setContact(null)}>Cambiar</Button>
          </p>
        ) : (
          <>
            <div className="mt-1 flex gap-2">
              <Input id="q-contact" placeholder="Nombre o teléfono" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)} />
              <Button variant="outline" onClick={() => void searchContacts()}>Buscar</Button>
            </div>
            <ul className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
              {contactResults.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full cursor-pointer rounded-xl border border-line bg-white px-3 py-2 text-left hover:border-ink"
                    onClick={() => setContact({ id: c.id, label: c.name?.trim() || c.phoneE164 })}
                  >
                    {c.name?.trim() || c.phoneE164} <span className="text-sm text-muted">{c.phoneE164}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="q-currency">Moneda</Label>
          <select
            id="q-currency"
            className="mt-1 block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px]"
            value={currency}
            disabled={Boolean(quote) && !replaceLines}
            onChange={(e) => {
              setCurrency(e.target.value);
              setLines([]);
              setProductResults([]);
            }}
          >
            {currencyOptions(currencySettings, currency).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="q-valid">Válido hasta</Label>
          <Input id="q-valid" type="date" className="mt-1" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <Label>Líneas</Label>
          {quote && !replaceLines ? <Button size="sm" variant="outline" onClick={() => setReplaceLines(true)}>Reemplazar líneas</Button> : null}
        </div>
        {quote && !replaceLines ? (
          <ul className="m-0 mt-2 list-none p-0 text-sm">
            {quote.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-2 border-b border-line py-1.5">
                <span>{i.quantityMilli / 1000} × {i.description}</span>
                <b>{formatMoneyMinor(i.lineTotalMinor, quote.currency)}</b>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <div className="mt-2 flex gap-2">
              <Input aria-label="Buscar producto" placeholder="Buscar en el catálogo" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
              <Button variant="outline" onClick={() => void searchProducts()}>Buscar</Button>
              <Button variant="outline" aria-label="Añadir línea libre" onClick={() => setLines((ls) => [...ls, newLine(null)])}><Plus aria-hidden className="size-4" />Libre</Button>
            </div>
            {productResults.length > 0 ? (
              <ul className="m-0 mt-2 flex max-h-44 list-none flex-col gap-1 overflow-y-auto p-0">
                {productResults.map((p) => (
                  <li key={p.variantId}>
                    <button
                      type="button"
                      className="flex w-full cursor-pointer justify-between gap-2 rounded-xl border border-line bg-white px-3 py-2 text-left hover:border-ink"
                      onClick={() => setLines((ls) => [...ls, newLine(p)])}
                    >
                      <span>{p.name}{p.variant ? ` · ${[p.variant.size, p.variant.color].filter(Boolean).join(" / ")}` : ""}</span>
                      <span className="text-sm text-muted">{formatMoneyMinor(p.priceMinor, p.currency)}{p.stock !== null ? ` · stock ${p.stock}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {lines.map((l) => (
                <li key={l.key} className="grid gap-2 rounded-2xl border border-line p-3 sm:grid-cols-[1fr_80px_100px_80px_auto]">
                  {l.item ? (
                    <span className="self-center font-bold">{l.description}</span>
                  ) : (
                    <Input aria-label="Descripción" placeholder="Descripción" value={l.description} onChange={(e) => patchLine(l.key, { description: e.target.value })} />
                  )}
                  <Input aria-label="Cantidad" inputMode="decimal" value={l.quantity} onChange={(e) => patchLine(l.key, { quantity: e.target.value })} />
                  {l.item ? (
                    <span className="self-center text-sm text-muted">{formatMoneyMinor(l.item.priceMinor, l.item.currency)}</span>
                  ) : (
                    <Input aria-label="Precio unitario" inputMode="decimal" placeholder={decimals ? "0,00" : "0"} value={l.price} onChange={(e) => patchLine(l.key, { price: e.target.value })} />
                  )}
                  <Input aria-label="Descuento %" inputMode="decimal" placeholder="Dto. %" value={l.discountPct} onChange={(e) => patchLine(l.key, { discountPct: e.target.value })} />
                  <Button variant="ghost" aria-label="Quitar línea" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-2 text-sm text-muted">Los importes e impuestos los calcula el servidor al guardar.</p>
          </>
        )}
      </div>

      <div>
        <Label htmlFor="q-notes">Notas</Label>
        <Textarea id="q-notes" rows={2} className="mt-1" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="q-terms">Condiciones</Label>
        <Textarea id="q-terms" rows={2} className="mt-1" value={terms} onChange={(e) => setTerms(e.target.value)} />
      </div>
    </Modal>
  );
}
