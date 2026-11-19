"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button } from "@/components/ui";
import { photoProblem, profileErrorMessage, whatsappProfileApi } from "@/lib/whatsapp-profile-api";

/** Photo picker with local preview; the upload happens only on "Subir foto". */
export function PhotoUpload({ channelId, currentUrl, onUploaded }: { channelId: string; currentUrl: string | null; onUploaded: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pick(next: File | undefined) {
    if (!next) return;
    const problem = photoProblem(next);
    setError(problem ?? undefined);
    setFile(problem ? null : next);
  }

  async function upload() {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await whatsappProfileApi.uploadPhoto(channelId, file);
      setFile(null);
      if (input.current) input.current.value = "";
      onUploaded();
    } catch (err) {
      setError(profileErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = preview ?? currentUrl;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-full border-[1.5px] border-ink bg-white text-xs text-muted">
          {shown ? (
            <img src={shown} alt="Foto de perfil" className="size-full object-cover" />
          ) : (
            "Sin foto"
          )}
        </div>
        <div className="flex flex-col gap-2">
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png"
            aria-label="Elegir foto de perfil"
            className="text-sm"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <p className="m-0 text-xs text-muted">JPG o PNG, cuadrada, hasta 5 MB.</p>
        </div>
      </div>
      <Alert>{error}</Alert>
      <div>
        <Button type="button" variant="outline" disabled={!file || busy} onClick={() => void upload()}>{busy ? "Subiendo…" : "Subir foto"}</Button>
      </div>
    </div>
  );
}
