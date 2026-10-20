"use client";

import { ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Banner, Toast, UploadTile } from "@/components/ui";
import { knowledgeApi } from "@/lib/ai-api";
import type { KnowledgeConflict, KnowledgeSource } from "@/lib/ai-schemas";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { SettingsFrame } from "./AccessGate";
import { ConflictsBanner } from "./ConflictsBanner";
import { SourceList } from "./SourceList";
import { TextSourceForm } from "./TextSourceForm";

const ACCEPT = { csv: ".csv,text/csv", pdf: ".pdf,application/pdf" } as const;

function Body({ canEdit }: { canEdit: boolean }) {
  const [sources, setSources] = useState<KnowledgeSource[] | null>(null);
  const [conflicts, setConflicts] = useState<KnowledgeConflict[]>([]);
  const [error, setError] = useState<string>();
  const [uploaded, setUploaded] = useState<{ csv: boolean; pdf: boolean }>({ csv: false, pdf: false });
  const [textOpen, setTextOpen] = useState(false);
  const csvRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const { message, show } = useToast();

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([knowledgeApi.listSources(), knowledgeApi.conflicts()]);
      setSources(s);
      setConflicts(c);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function upload(kind: "csv" | "pdf", file: File | undefined) {
    if (!file) return;
    setError(undefined);
    try {
      await knowledgeApi.createSource({ kind, file });
      setUploaded((u) => ({ ...u, [kind]: true }));
      show(`${file.name} subido`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <Banner tone="info" icon={ShieldCheck}>La IA solo puede dar precios, stock y plazos que estén aquí.</Banner>
      {conflicts.length > 0 ? <ConflictsBanner conflicts={conflicts} /> : null}
      {canEdit ? (
        <section aria-label="Añadir conocimiento" className="grid gap-3 md:grid-cols-3">
          <UploadTile title="Catálogo de precios (CSV)" hint="Columnas: nombre, precio, moneda" done={uploaded.csv} onPick={() => csvRef.current?.click()} />
          <UploadTile title="Documento (PDF)" hint="Condiciones, garantías, políticas" done={uploaded.pdf} onPick={() => pdfRef.current?.click()} />
          <UploadTile title="FAQ o texto pegado" hint="Respuestas frecuentes" done={false} onPick={() => setTextOpen(true)} />
          <input ref={csvRef} type="file" accept={ACCEPT.csv} hidden data-testid="csv-input" onChange={(e) => { void upload("csv", e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={pdfRef} type="file" accept={ACCEPT.pdf} hidden data-testid="pdf-input" onChange={(e) => { void upload("pdf", e.target.files?.[0]); e.target.value = ""; }} />
        </section>
      ) : null}
      <Alert>{error}</Alert>
      {sources === null && !error ? (
        <p className="text-muted" aria-busy="true">Cargando fuentes…</p>
      ) : (
        <SourceList sources={sources ?? []} canEdit={canEdit} onDeleted={() => { show("Fuente borrada"); void load(); }} onError={setError} />
      )}
      {textOpen ? <TextSourceForm onClose={() => setTextOpen(false)} onCreated={() => { setTextOpen(false); show("Texto añadido"); void load(); }} /> : null}
      <Toast message={message} />
    </div>
  );
}

export function KnowledgeView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Configuración" subtitle="El conocimiento en el que se apoya tu agente de IA.">
      {() => <Body canEdit={canManageAi(tenant?.role)} />}
    </SettingsFrame>
  );
}

