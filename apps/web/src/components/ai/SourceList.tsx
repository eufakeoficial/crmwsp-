"use client";

import { FileText, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/app/EmptyState";
import { Button, Card, Modal, StatusChip, type Tone } from "@/components/ui";
import { knowledgeApi } from "@/lib/ai-api";
import type { KnowledgeSource } from "@/lib/ai-schemas";
import { formatRelative } from "@/lib/format";
import { errorMessage } from "@/lib/messages";

const STATUS: Record<KnowledgeSource["status"], { label: string; tone: Tone }> = {
  pending: { label: "Pendiente", tone: "paper" },
  processing: { label: "Procesando", tone: "info" },
  ready: { label: "Lista", tone: "success" },
  error: { label: "Error", tone: "danger" },
};
const KIND: Record<KnowledgeSource["kind"], string> = { csv: "CSV", pdf: "PDF", faq: "FAQ", text: "Texto" };

export function SourceList({ sources, canEdit, onDeleted, onError }: { sources: KnowledgeSource[]; canEdit: boolean; onDeleted: () => void; onError: (msg: string) => void }) {
  const [target, setTarget] = useState<KnowledgeSource | null>(null);

  async function remove(s: KnowledgeSource) {
    setTarget(null);
    try {
      await knowledgeApi.deleteSource(s.id);
      onDeleted();
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  if (sources.length === 0) return <EmptyState title="Aún no hay fuentes">{canEdit ? "Sube tu lista de precios o pega tus preguntas frecuentes para empezar." : "Pide a un administrador que añada conocimiento."}</EmptyState>;
  return (
    <section id="sources" aria-label="Fuentes de conocimiento">
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {sources.map((s) => (
          <li key={s.id}>
            <Card className="flex flex-wrap items-center gap-3 p-4 sm:p-4">
              <span aria-hidden className="grid size-10 flex-none place-items-center rounded-xl bg-paper"><FileText className="size-5" /></span>
              <div className="min-w-0 flex-1 basis-48">
                <b className="block truncate">{s.title}</b>
                <span className="text-sm text-muted">
                  {KIND[s.kind]} · v{s.version} · {s.chunkCount} {s.chunkCount === 1 ? "fragmento" : "fragmentos"} · {formatRelative(s.updatedAt)}
                </span>
                {s.status === "error" && s.error ? <span className="block text-sm font-semibold text-danger">{s.error}</span> : null}
              </div>
              <StatusChip label={STATUS[s.status].label} tone={STATUS[s.status].tone} />
              {canEdit ? (
                <Button variant="ghost" size="sm" onClick={() => setTarget(s)} aria-label={`Borrar ${s.title}`}><Trash2 aria-hidden className="size-4" />Borrar</Button>
              ) : null}
            </Card>
          </li>
        ))}
      </ul>
      {target ? (
        <Modal title="¿Borrar esta fuente?" onClose={() => setTarget(null)} footer={<><Button variant="outline" onClick={() => setTarget(null)}>Cancelar</Button><Button variant="primary" onClick={() => void remove(target)}>Borrar fuente</Button></>}>
          <p className="m-0"><b>{target.title}</b> y sus {target.chunkCount} fragmentos dejarán de estar disponibles para la IA.</p>
        </Modal>
      ) : null}
    </section>
  );
}
