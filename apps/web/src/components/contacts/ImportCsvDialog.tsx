"use client";

import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, parseContactCsv, type ImportContactsResult, type ImportSkipReason } from "@crmwsp/contracts";
import { useMemo, useState } from "react";
import { Alert, Button, Modal } from "@/components/ui";
import { contactBookApi } from "@/lib/contacts-api";
import { errorMessage } from "@/lib/messages";

const SKIP_LABELS: Record<ImportSkipReason, string> = {
  missing_phone: "sin teléfono",
  invalid_phone: "teléfono no válido",
  duplicate_in_file: "repetido en el archivo",
  invalid_tags: "etiquetas no válidas",
};

/** CSV import with a local preview; the API re-parses and is the source of truth. */
export function ImportCsvDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [csv, setCsv] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<ImportContactsResult | null>(null);
  const preview = useMemo(() => (csv ? parseContactCsv(csv) : null), [csv]);

  async function onFile(file: File | undefined) {
    setResult(null);
    setError(null);
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
      setFileError("El archivo supera 2 MB.");
      return;
    }
    setFileError(null);
    setCsv(await file.text());
  }

  async function submit() {
    setBusy(true);
    try {
      setResult(await contactBookApi.importCsv(csv));
      onImported();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const canImport = preview && preview.columns.phone && !preview.truncated && preview.rows.length > 0 && !result;
  const skipped = result?.skipped ?? [];

  return (
    <Modal
      title="Importar contactos (CSV)"
      wide
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{result ? "Cerrar" : "Cancelar"}</Button>
          {result ? null : (
            <Button disabled={!canImport || busy} onClick={() => void submit()}>
              {busy ? "Importando…" : `Importar ${preview?.rows.length ?? 0} filas`}
            </Button>
          )}
        </>
      }
    >
      <p className="mt-0 text-sm text-muted">
        Columnas: <b>telefono</b> (obligatoria), nombre, email, etiquetas (separadas por |) y, solo si tienes el permiso
        del cliente, <b>acepta_marketing</b> (sí/no). Máximo {IMPORT_MAX_ROWS.toLocaleString("es")} filas. Los teléfonos repetidos
        se fusionan con el contacto existente.
      </p>
      <input type="file" accept=".csv,text/csv" aria-label="Archivo CSV" onChange={(e) => void onFile(e.target.files?.[0])} />
      {fileError ? <div className="mt-3"><Alert>{fileError}</Alert></div> : null}
      {error ? <div className="mt-3"><Alert>{errorMessage(error)}</Alert></div> : null}

      {preview && !result ? (
        <div className="mt-4">
          {!preview.columns.phone ? <Alert>No encontramos la columna de teléfono.</Alert> : null}
          {preview.truncated ? <Alert>El archivo tiene más de {IMPORT_MAX_ROWS} filas; divídelo.</Alert> : null}
          <p className="text-sm">
            {preview.rows.length} filas · consentimiento de marketing:{" "}
            {preview.columns.marketingConsent ? "se registrará desde la columna" : "no se modificará"}
          </p>
          <div className="overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-muted">
                  <th>Línea</th>
                  <th>Teléfono</th>
                  <th>Nombre</th>
                  <th>Email</th>
                  <th>Etiquetas</th>
                  <th>Marketing</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 5).map((r) => (
                  <tr key={r.line}>
                    <td>{r.line}</td>
                    <td>{r.phone || "—"}</td>
                    <td>{r.name || "—"}</td>
                    <td>{r.email || "—"}</td>
                    <td>{r.tags.join(", ") || "—"}</td>
                    <td>{r.marketingConsent === "granted" ? "Sí" : r.marketingConsent === "revoked" ? "No" : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="mt-4 text-sm">
          <p className="font-bold">
            {result.created} creados · {result.updated} actualizados · {skipped.length} omitidos
          </p>
          {skipped.length ? (
            <ul className="max-h-48 overflow-auto">
              {skipped.slice(0, 200).map((s) => (
                <li key={s.line}>
                  Línea {s.line}: {SKIP_LABELS[s.reason]}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
