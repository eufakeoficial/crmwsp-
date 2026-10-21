"use client";

import type { OrderExtractionDto, OrderExtractionLine } from "@crmwsp/contracts";
import { FileText, Image as ImageIcon, Mic, PackageSearch, Trash2 } from "lucide-react";
import { useState } from "react";
import { Alert, Button, StatusChip } from "@/components/ui";
import { formatMoneyMinor } from "@/lib/format";
import { orderExtractionsApi } from "@/lib/order-extractions-api";

const SOURCE_ICON = { audio: Mic, image: ImageIcon, pdf: FileText } as const;
const SOURCE_LABEL = { audio: "audio", image: "foto", pdf: "PDF" } as const;

const REASON_LABEL: Record<NonNullable<OrderExtractionLine["reason"]>, string> = {
  no_match: "No está en el catálogo",
  ambiguous: "Nombre ambiguo",
  low_confidence: "Coincidencia dudosa",
  no_quantity: "Falta la cantidad",
  unit_mismatch: "Unidad distinta a la del catálogo",
  currency_mismatch: "Otra moneda",
};

const STATUS_LABEL: Record<OrderExtractionDto["status"], string> = {
  needs_confirmation: "Por confirmar",
  ready: "Listo",
  applied: "Aplicado",
  discarded: "Descartado",
  skipped: "No leído",
  failed: "Error",
};

const qty = (milli: number | null): string => (milli === null ? "—" : String(milli / 1000));

/**
 * "Pedido detectado" card for the inbox thread (F4): the table the AI extracted from a voice note,
 * photo or PDF, with catalog matches an agent can fix before submitting the draft quote. Prices
 * shown come from the catalog (the server re-prices on every change).
 */
export function OrderExtractionCard({
  extraction,
  onChange,
  readOnly = false,
}: {
  extraction: OrderExtractionDto;
  onChange?: (next: OrderExtractionDto) => void;
  readOnly?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qtyDraft, setQtyDraft] = useState<Record<number, string>>({});
  const editable = !readOnly && (extraction.status === "needs_confirmation" || extraction.status === "ready");
  const Icon = SOURCE_ICON[extraction.source];

  async function run(fn: () => Promise<OrderExtractionDto>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      onChange?.(await fn());
    } catch {
      setError("No se pudo guardar. Recargá el pedido e intentá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  const pick = (l: OrderExtractionLine, value: string) => {
    const alt = l.alternatives.find((a) => `${a.productId}:${a.variantId ?? ""}` === value);
    if (!alt) return;
    void run(() => orderExtractionsApi.updateLine(extraction.id, l.index, { lockVersion: extraction.lockVersion, productId: alt.productId, variantId: alt.variantId }));
  };
  const saveQty = (l: OrderExtractionLine) => {
    const n = Number((qtyDraft[l.index] ?? "").replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return;
    void run(() => orderExtractionsApi.updateLine(extraction.id, l.index, { lockVersion: extraction.lockVersion, quantity: n }));
  };
  const remove = (l: OrderExtractionLine) =>
    void run(() => orderExtractionsApi.updateLine(extraction.id, l.index, { lockVersion: extraction.lockVersion, remove: true }));

  return (
    <section aria-label="Pedido detectado" className="rounded-2xl border border-line bg-white p-4 text-[13px]">
      <header className="mb-3 flex items-center gap-2">
        <PackageSearch aria-hidden className="size-4" />
        <h3 className="font-extrabold">Pedido detectado</h3>
        <span className="flex items-center gap-1 text-ink/60">
          <Icon aria-hidden className="size-3.5" /> por {SOURCE_LABEL[extraction.source]}
        </span>
        <StatusChip className="ml-auto" label={STATUS_LABEL[extraction.status]} />
      </header>

      {extraction.status === "skipped" || extraction.status === "failed" ? (
        <p className="text-ink/70">La IA no pudo leer este {SOURCE_LABEL[extraction.source]}. Revisalo y cargá el pedido a mano.</p>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left text-xs text-ink/60">
              <th className="py-1 font-semibold">Pedido</th>
              <th className="py-1 font-semibold">Producto del catálogo</th>
              <th className="py-1 text-right font-semibold">Cant.</th>
              <th className="py-1 text-right font-semibold">Precio</th>
              {editable ? <th className="sr-only">Acciones</th> : null}
            </tr>
          </thead>
          <tbody>
            {extraction.lines.map((l) => (
              <tr key={l.index} className={l.status === "dudoso" ? "bg-lime/15" : undefined}>
                <td className="py-1.5 pr-2 align-top">
                  <div className="font-semibold">{l.productGuess}</div>
                  <div className="text-xs text-ink/60">
                    {l.quantity ?? "?"} {l.unit ?? ""}
                  </div>
                </td>
                <td className="py-1.5 pr-2 align-top">
                  {editable && l.alternatives.length > 0 ? (
                    <select
                      aria-label={`Producto para ${l.productGuess}`}
                      className="w-full rounded-lg border border-line bg-white px-2 py-1"
                      disabled={busy}
                      value={l.match ? `${l.match.productId}:${l.match.variantId ?? ""}` : ""}
                      onChange={(e) => pick(l, e.target.value)}
                    >
                      <option value="">Elegir…</option>
                      {l.alternatives.map((a) => (
                        <option key={`${a.productId}:${a.variantId ?? ""}`} value={`${a.productId}:${a.variantId ?? ""}`}>
                          {a.label}
                        </option>
                      ))}
                      {l.match && !l.alternatives.some((a) => a.productId === l.match!.productId && a.variantId === l.match!.variantId) ? (
                        <option value={`${l.match.productId}:${l.match.variantId ?? ""}`}>{l.match.label}</option>
                      ) : null}
                    </select>
                  ) : (
                    <span>{l.match?.label ?? "—"}</span>
                  )}
                  {l.status === "dudoso" && l.reason ? <div className="mt-0.5 text-xs font-semibold text-ink/70">Dudoso: {REASON_LABEL[l.reason]}</div> : null}
                </td>
                <td className="py-1.5 text-right align-top">
                  {editable && l.match ? (
                    <input
                      aria-label={`Cantidad de ${l.match.label} (${l.match.unit})`}
                      className="w-16 rounded-lg border border-line px-1.5 py-1 text-right"
                      disabled={busy}
                      inputMode="decimal"
                      value={qtyDraft[l.index] ?? (l.quantityMilli === null ? "" : qty(l.quantityMilli))}
                      onChange={(e) => setQtyDraft((d) => ({ ...d, [l.index]: e.target.value }))}
                      onBlur={() => (qtyDraft[l.index] !== undefined ? saveQty(l) : undefined)}
                    />
                  ) : (
                    qty(l.quantityMilli)
                  )}
                  {l.match ? <div className="text-xs text-ink/60">{l.match.unit}</div> : null}
                </td>
                <td className="py-1.5 text-right align-top whitespace-nowrap">
                  {l.match ? formatMoneyMinor(l.match.unitPriceMinor, l.match.currency) : "—"}
                </td>
                {editable ? (
                  <td className="py-1.5 pl-1 text-right align-top">
                    <button type="button" aria-label={`Quitar ${l.productGuess}`} disabled={busy} className="rounded p-1 hover:bg-ink/8" onClick={() => remove(l)}>
                      <Trash2 aria-hidden className="size-3.5" />
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {extraction.notes ? <p className="mt-2 text-xs text-ink/70">Notas: {extraction.notes}</p> : null}
      <div className="mt-2">
        <Alert>{error}</Alert>
      </div>

      <footer className="mt-3 flex items-center gap-2">
        {extraction.quote ? (
          <span className="text-ink/70">
            Borrador {extraction.quote.number}
            {extraction.currency ? ` · ${formatMoneyMinor(extraction.quote.totalMinor, extraction.currency)}` : ""}
          </span>
        ) : (
          <span className="text-ink/60">Sin presupuesto todavía</span>
        )}
        {editable ? (
          <Button
            className="ml-auto"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => orderExtractionsApi.discard(extraction.id, extraction.lockVersion))}
          >
            Descartar
          </Button>
        ) : null}
      </footer>
    </section>
  );
}
