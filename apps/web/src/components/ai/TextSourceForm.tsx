"use client";

import { type FormEvent, useState } from "react";
import { Alert, Button, Input, Label, Modal, Spinner, Textarea } from "@/components/ui";
import { knowledgeApi } from "@/lib/ai-api";
import { errorMessage } from "@/lib/messages";

/** Paste FAQ pairs or free text as a knowledge source. */
export function TextSourceForm({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [kind, setKind] = useState<"faq" | "text">("faq");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return setError("Indica un título y pega el contenido.");
    setBusy(true);
    try {
      await knowledgeApi.createSource({ kind, title: title.trim(), content });
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Modal title="Añadir FAQ o texto" onClose={onClose} wide>
      <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ks-kind">Tipo</Label>
          <select id="ks-kind" value={kind} onChange={(e) => setKind(e.target.value as "faq" | "text")} className="h-12 rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px]">
            <option value="faq">Preguntas frecuentes</option>
            <option value="text">Texto libre</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ks-title">Título</Label>
          <Input id="ks-title" data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ks-content">Contenido</Label>
          <Textarea id="ks-content" rows={8} value={content} onChange={(e) => setContent(e.target.value)} />
        </div>
        <Alert>{error}</Alert>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="accent" disabled={busy}>{busy ? <Spinner /> : null}Añadir</Button>
        </div>
      </form>
    </Modal>
  );
}
