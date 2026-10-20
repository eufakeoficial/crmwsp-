import { Check, X } from "lucide-react";
import { Button, LeadCard, StatusChip } from "@/components/ui";
import { actionTypeLabel, payloadSummary } from "@/lib/ai-actions";
import type { AiAction } from "@/lib/ai-schemas";
import { formatRelative } from "@/lib/format";

/** One AI action waiting for a human decision. */
export function ActionCard({ action, canDecide, busy, onDecide }: { action: AiAction; canDecide: boolean; busy: boolean; onDecide: (kind: "approve" | "reject") => void }) {
  const summary = payloadSummary(action.payload);
  return (
    <LeadCard
      title={action.contactName ?? "Conversación sin contacto"}
      subtitle={`${actionTypeLabel(action.type)} · ${formatRelative(action.createdAt)}`}
      badge={<StatusChip label="En revisión" />}
      fields={[
        { label: "Tipo", value: actionTypeLabel(action.type) },
        { label: "Conversación", value: action.conversationId ? action.conversationId.slice(-6) : "—" },
        ...summary.slice(0, 4).map((f) => ({ label: f.label, value: f.value })),
      ]}
      actions={
        <div className="flex w-full flex-col gap-3">
          <p className="m-0 text-sm"><b>Motivo:</b> {action.reason ?? "Requiere aprobación según tus reglas."}</p>
          <div className="text-sm">
            <b>Citas:</b>
            {action.citations.length === 0 ? (
              <span className="text-warning"> sin citas: la IA no pudo respaldar esta acción con tu conocimiento.</span>
            ) : (
              <ul className="m-0 mt-1 list-disc pl-5 text-ink-3">
                {action.citations.map((c) => <li key={c.chunkId}>{c.title ?? c.chunkId}{c.excerpt ? ` — «${c.excerpt}»` : ""}</li>)}
              </ul>
            )}
          </div>
          {canDecide ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" disabled={busy} onClick={() => onDecide("approve")}><Check aria-hidden className="size-4" />Aprobar</Button>
              <Button variant="outline" disabled={busy} onClick={() => onDecide("reject")}><X aria-hidden className="size-4" />Rechazar</Button>
            </div>
          ) : null}
        </div>
      }
    />
  );
}
