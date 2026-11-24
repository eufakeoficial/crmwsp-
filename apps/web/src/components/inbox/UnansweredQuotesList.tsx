"use client";

import type { UnansweredQuote, UnansweredQuoteCounts } from "@crmwsp/contracts";
import { CircleCheck } from "lucide-react";
import { Alert, Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatDateTime, formatMoneyMinor, formatRelative } from "@/lib/format";
import { UNANSWERED_FOLDER_LABEL, quoteContactLabel, unknownCoverageLabel } from "./unanswered-quotes-meta";

export function UnansweredQuotesList({
  items,
  counts,
  selectedId,
  canReview,
  busyQuoteId,
  loading,
  loadingMore,
  hasMore,
  error,
  listRef,
  onSelect,
  onReview,
  onRetry,
  onLoadMore,
}: {
  items: readonly UnansweredQuote[];
  counts: UnansweredQuoteCounts | null;
  /** Open conversation; highlights the row whose chat is being shown. */
  selectedId: string | null;
  canReview: boolean;
  /** Quote whose review request is in flight; disables every review button meanwhile. */
  busyQuoteId: string | null;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | undefined;
  listRef: (el: HTMLUListElement | null) => void;
  onSelect: (conversationId: string) => void;
  onReview: (quoteId: string) => void;
  onRetry: () => void;
  onLoadMore: () => void;
}) {
  return (
    <section aria-label={UNANSWERED_FOLDER_LABEL} className="flex min-h-0 flex-col bg-white">
      <Alert>{error}</Alert>
      {error ? (
        <div className="flex justify-center px-3 py-3">
          <Button size="sm" variant="outline" onClick={onRetry}>
            Reintentar
          </Button>
        </div>
      ) : null}
      <ul ref={listRef} data-testid="unanswered-quote-list" className="m-0 flex min-h-0 flex-1 list-none flex-col overflow-y-auto p-0">
        {counts && counts.unknownCoverage > 0 ? (
          <li className="bg-paper px-3 py-2 text-[13px] text-muted">{unknownCoverageLabel(counts.unknownCoverage)}</li>
        ) : null}
        {items.map((quote) => {
          const selected = quote.conversationId === selectedId;
          return (
            <li
              key={quote.quoteId}
              data-testid="unanswered-quote"
              className={cn("flex items-stretch border-b border-line pl-3", selected ? "bg-lime-soft" : "hover:bg-paper-2")}
            >
              <button
                type="button"
                onClick={() => onSelect(quote.conversationId)}
                aria-current={selected ? "true" : undefined}
                className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 bg-transparent px-3 py-3 text-left"
              >
                <span className="flex items-center gap-2">
                  <b className="min-w-0 flex-1 truncate text-[15px] font-semibold">{quoteContactLabel(quote)}</b>
                  <span className="flex-none text-[14px] font-bold tabular-nums">{formatMoneyMinor(quote.totalMinor, quote.currency)}</span>
                </span>
                <span className="block truncate text-[13px] text-muted">
                  {quote.number} · Enviado {formatRelative(quote.sentAt)}
                </span>
                <span className="text-xs text-muted">
                  <span className="block truncate">{quote.assignee ? `Responsable: ${quote.assignee.name}` : "Sin asignar"}</span>
                  {quote.reminderAt ? <span className="block truncate">Recordatorio: {formatDateTime(quote.reminderAt)}</span> : null}
                </span>
              </button>
              {canReview ? (
                <div className="my-auto flex-none pr-3">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busyQuoteId !== null}
                    onClick={() => onReview(quote.quoteId)}
                    aria-label={`Marcar ${quote.number} como revisada`}
                    aria-busy={busyQuoteId === quote.quoteId ? "true" : undefined}
                  >
                    <CircleCheck aria-hidden className="size-4" />
                    <span className="desk:hidden">Revisar</span>
                    <span className="hidden desk:inline">Marcar como revisada</span>
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
        {!loading && !error && items.length === 0 ? (
          <li className="px-3 py-8 text-center text-sm text-muted">No hay presupuestos sin respuesta.</li>
        ) : null}
        {loading ? (
          <li className="px-3 py-8 text-center text-sm text-muted" aria-busy="true">
            Cargando…
          </li>
        ) : null}
        {hasMore ? (
          <li className="flex justify-center py-2">
            <Button size="sm" variant="outline" disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? "Cargando…" : "Cargar más"}
            </Button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
