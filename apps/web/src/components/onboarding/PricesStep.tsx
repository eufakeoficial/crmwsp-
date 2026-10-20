"use client";

import { Upload } from "lucide-react";
import { useRef, useState } from "react";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { knowledgeApi } from "@/lib/ai-api";
import { errorMessage } from "@/lib/messages";
import { type PriceRow, normalizePrice, parseCsvText, rowsFromCsv, rowsToCsv, validateRows } from "./price-table";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function fieldInvalid(r: PriceRow, f: keyof PriceRow): boolean {
  if (f === "name") return !r.name.trim();
  if (f === "price") return normalizePrice(r.price) === null;
  if (f === "currency") return !/^[A-Za-z]{3}$/.test(r.currency.trim());
  return false;
}

/** Upload a price list: CSV is previewed/edited then imported; PDF goes straight to the existing PDF source. */
export function PricesStep({ onImported }: { onImported: (what: string) => void }) {
  const [rows, setRows] = useState<PriceRow[] | null>(null);
  const [note, setNote] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(undefined);
    setNote(undefined);
    const lower = file.name.toLowerCase();
    if (file.size > MAX_FILE_BYTES) return setError("El archivo supera los 10 MB.");
    if (/\.xlsx?$/.test(lower)) return setError("Exporta tu Excel como CSV (Archivo → Guardar como → CSV) y súbelo aquí.");
    if (lower.endsWith(".pdf")) {
      setBusy(true);
      try {
        await knowledgeApi.createSource({ kind: "pdf", file });
        onImported(`${file.name} subido`);
        setRows(null);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!lower.endsWith(".csv")) return setError("Formato no admitido. Sube un CSV o un PDF.");
    const parsed = rowsFromCsv(parseCsvText(await file.text()));
    if (parsed.error) return setError(parsed.error);
    if (parsed.rows.length === 0) return setError("No hay filas con datos.");
    if (parsed.truncated) setNote("Mostramos las primeras 2000 filas; divide el archivo para importar el resto.");
    setRows(parsed.rows);
  }

  const issues = rows ? validateRows(rows) : [];
  const issueAt = new Map(issues.map((i) => [i.index, i.reason]));

  function edit(i: number, patch: Partial<PriceRow>) {
    setRows((rs) => (rs ? rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)) : rs));
  }

  async function importRows() {
    if (!rows || issues.length > 0) return;
    setBusy(true);
    setError(undefined);
    try {
      const file = new File([rowsToCsv(rows)], "lista-de-precios.csv", { type: "text/csv" });
      await knowledgeApi.createSource({ kind: "csv", file });
      onImported(`${rows.length} productos importados`);
      setRows(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">Sube un CSV o un PDF. Si usas Excel, exporta tu hoja como CSV.</p>
      <div>
        <Button variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload aria-hidden className="size-4" />
          Elegir archivo (CSV o PDF)
        </Button>
        <input ref={inputRef} type="file" hidden accept=".csv,.pdf,text/csv,application/pdf" data-testid="prices-input" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <Alert>{error}</Alert>
      {note ? <p className="m-0 text-sm text-muted">{note}</p> : null}
      {rows ? (
        <>
          <p className="m-0 text-sm font-bold">Revisa los {rows.length} productos antes de importar</p>
          <div className="max-h-[320px] overflow-auto rounded-[14px] border border-line">
            <table className="w-full min-w-[560px] border-collapse text-sm">
              <thead className="sticky top-0 bg-paper-2 text-left">
                <tr>
                  <th className="px-2 py-1.5">Nombre</th>
                  <th className="px-2 py-1.5">Variante</th>
                  <th className="px-2 py-1.5">Precio</th>
                  <th className="px-2 py-1.5">Moneda</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-line" title={issueAt.get(i)}>
                    {(["name", "variant", "price", "currency"] as const).map((f) => (
                      <td key={f} className="p-1">
                        <Input
                          aria-label={`${f} fila ${i + 1}`}
                          aria-invalid={fieldInvalid(r, f)}
                          className="h-9 rounded-[10px] px-2 text-[14px]"
                          value={r[f]}
                          onChange={(e) => edit(i, { [f]: e.target.value })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {issues.length > 0 ? <Alert>{`${issues.length} filas con errores (la primera: fila ${issues[0]!.index + 1}, ${issues[0]!.reason.toLowerCase()}). Corrígelas para importar.`}</Alert> : null}
          <div className="flex gap-2">
            <Button variant="accent" disabled={busy || issues.length > 0} onClick={() => void importRows()}>
              {busy ? <Spinner /> : null}Importar {rows.length} productos
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setRows(null)}>Descartar</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
