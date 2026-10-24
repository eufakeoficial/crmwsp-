"use client";

import type { MessageTemplateDto, TemplateCategory, TemplateLintResponse } from "@crmwsp/contracts";
import { Info } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { lintTemplateRemote } from "@/lib/policies-api";
import { Alert, Banner, Button, Input, Label, Modal, Spinner, Textarea } from "@/components/ui";
import { templateErrorMessage, waTemplatesApi } from "@/lib/wa-templates-api";
import {
  CATEGORY_LABELS,
  LANGUAGE_OPTIONS,
  OPT_OUT_LINE,
  extractVariables,
  hasOptOutLine,
  normalizeTemplateName,
  validateTemplateDraft,
} from "@/lib/wa-templates";
import { TemplatePreview } from "./TemplatePreview";

const SELECT = "block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3 text-[16px]";

/** Creates a template and submits it to Meta review through the channel's BSP. */
export function TemplateFormDialog({ channelId, onClose, onCreated }: { channelId: string; onClose: () => void; onCreated: (t: MessageTemplateDto) => void }) {
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es");
  const [category, setCategory] = useState<TemplateCategory>("utility");
  const [body, setBody] = useState("");
  const [samples, setSamples] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [apiError, setApiError] = useState<string>();

  const vars = useMemo(() => extractVariables(body), [body]);
  const validation = useMemo(() => validateTemplateDraft({ name, language, category, body, samples }), [name, language, category, body, samples]);
  const errors = touched ? validation.errors : {};
  const [lint, setLint] = useState<TemplateLintResponse | null>(null);
  useEffect(() => {
    if (!body.trim()) return setLint(null);
    // Debounced; a failed lint call never blocks (the API re-checks on submit).
    const t = setTimeout(() => {
      lintTemplateRemote({ category, body }).then(setLint, () => setLint(null));
    }, 400);
    return () => clearTimeout(t);
  }, [body, category]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!validation.request) return;
    if (lint && !lint.ok) return;
    setBusy(true);
    setApiError(undefined);
    try {
      onCreated(await waTemplatesApi.submit(channelId, validation.request));
    } catch (err) {
      setApiError(templateErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nueva plantilla de WhatsApp" onClose={onClose} wide>
      <form onSubmit={submit} noValidate className="flex flex-col">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-name">Nombre</Label>
            <Input id="tpl-name" data-autofocus autoComplete="off" value={name} aria-invalid={Boolean(errors.name)} onChange={(e) => setName(e.target.value)} onBlur={() => setName((n) => (n === "" ? n : normalizeTemplateName(n) || n))} placeholder="promo_otono" />
            <span className={errors.name ? "text-xs font-bold text-danger" : "text-xs text-muted"}>{errors.name ?? "Minúsculas, números y guiones bajos. No se puede cambiar después."}</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-cat">Categoría</Label>
              <select id="tpl-cat" className={SELECT} value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
                {(Object.keys(CATEGORY_LABELS) as TemplateCategory[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tpl-lang">Idioma</Label>
              <select id="tpl-lang" className={SELECT} value={language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGE_OPTIONS.map((l) => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
              {errors.language ? <span className="text-xs font-bold text-danger">{errors.language}</span> : null}
            </div>
          </div>
          {category === "marketing" ? (
            <Banner tone="info" icon={Info}>
              <span>
                Las plantillas de marketing solo se pueden enviar a contactos que dieron su consentimiento (opt-in). Incluye una línea para darse de baja, por ejemplo: <b>{OPT_OUT_LINE}</b>.
                {!hasOptOutLine(body) ? (
                  <>
                    {" "}
                    <button type="button" className="font-bold underline" onClick={() => setBody((b) => `${b.trimEnd()}${b.trim() ? "\n\n" : ""}${OPT_OUT_LINE}`)}>
                      Añadir la línea
                    </button>
                  </>
                ) : null}
              </span>
            </Banner>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="tpl-body">Mensaje</Label>
            <Textarea id="tpl-body" rows={6} maxLength={1024} value={body} aria-invalid={Boolean(errors.body)} onChange={(e) => setBody(e.target.value)} placeholder="Hola {{1}}, tu pedido {{2}} está listo." />
            <span className={errors.body ? "text-xs font-bold text-danger" : "text-xs text-muted"}>
              {errors.body ?? `Usa {{1}}, {{2}}… para datos que cambian por cliente. ${body.length}/1024`}
            </span>
          </div>
          {vars.length > 0 ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-sm font-bold">Ejemplos de las variables</legend>
              {vars.map((n) => (
                <div key={n} className="flex items-center gap-2">
                  <code className="w-12 text-sm">{`{{${n}}}`}</code>
                  <Input aria-label={`Ejemplo de la variable ${n}`} value={samples[n - 1] ?? ""} onChange={(e) => setSamples((s) => { const next = [...s]; for (let i = 0; i < n; i++) next[i] ??= ""; next[n - 1] = e.target.value; return next; })} />
                </div>
              ))}
              <span className={errors.samples ? "text-xs font-bold text-danger" : "text-xs text-muted"}>{errors.samples ?? "Meta los exige para revisar la plantilla."}</span>
            </fieldset>
          ) : null}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-bold">Vista previa</span>
            <TemplatePreview body={body} samples={samples} />
          </div>
          <p className="m-0 text-xs text-muted">Por ahora solo se admite texto en el cuerpo del mensaje (sin encabezado, pie ni botones).</p>
          {lint && lint.issues.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs" data-testid="template-lint">
              {lint.issues.map((i) => (
                <li key={i.code} className={i.level === "error" ? "font-bold text-danger" : "text-amber-800"}>
                  {i.level === "error" ? "Error: " : "Aviso: "}
                  {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          <Alert>{apiError}</Alert>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" variant="accent" disabled={busy}>
              {busy ? <Spinner /> : null}Enviar a aprobación
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
