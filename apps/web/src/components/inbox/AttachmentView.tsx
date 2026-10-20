"use client";

import type { Attachment, Message } from "@crmwsp/contracts";
import { ChevronDown, ChevronUp, FileText } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui";
import { attachmentsApi } from "@/lib/inbox-api";

type Kind = "audio" | "image" | "document" | "other";

export function attachmentKind(messageType: Message["type"], mimeType: string | null): Kind {
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("audio/") || messageType === "audio") return "audio";
  if (mime.startsWith("image/") || messageType === "image") return "image";
  if (messageType === "document" || mime === "application/pdf") return "document";
  return "other";
}

type UrlState = { status: "idle" | "loading" | "error" } | { status: "ready"; url: string };

/** Fetches the short-lived signed URL once the attachment is stored; `enabled=false` defers it (documents). */
function useAttachmentUrl(id: string, stored: boolean, enabled: boolean): [UrlState, () => void] {
  const [state, setState] = useState<UrlState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!stored || !enabled) return;
    let cancelled = false;
    setState({ status: "loading" });
    attachmentsApi
      .url(id)
      .then((r) => !cancelled && setState({ status: "ready", url: r.url }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [id, stored, enabled, nonce]);
  return [state, () => setNonce((n) => n + 1)];
}

const SPEEDS = [1, 1.5, 2] as const;

function AudioAttachment({ attachment }: { attachment: Attachment }) {
  const stored = attachment.storageKey !== null;
  const [url, retry] = useAttachmentUrl(attachment.id, stored, true);
  const [rate, setRate] = useState<number>(1);
  const [open, setOpen] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = rate;
  }, [rate, url]);
  const transcript = attachment.transcript?.trim() ?? "";
  return (
    <div className="flex min-w-[240px] flex-col gap-1.5">
      {!stored ? (
        <p className="m-0 text-xs text-muted">Audio no disponible todavía (procesando)</p>
      ) : url.status === "ready" ? (
        <>
          <audio ref={audio} controls preload="metadata" src={url.url} className="h-10 w-full" onError={retry} />
          <div role="group" aria-label="Velocidad de reproducción" className="flex gap-1">
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={rate === s}
                onClick={() => setRate(s)}
                className={`cursor-pointer rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold ${rate === s ? "bg-ink text-white" : "bg-paper text-ink"}`}
              >
                {s}x
              </button>
            ))}
          </div>
        </>
      ) : url.status === "error" ? (
        <button type="button" onClick={retry} className="cursor-pointer text-left text-xs font-semibold text-danger underline">
          No se pudo cargar el audio. Reintentar
        </button>
      ) : (
        <p className="m-0 text-xs text-muted">Cargando audio…</p>
      )}
      {transcript ? (
        <div className="text-[13px]">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold underline"
          >
            {open ? <ChevronUp aria-hidden className="size-3.5" /> : <ChevronDown aria-hidden className="size-3.5" />}
            Transcripción
          </button>
          {open ? <p className="m-0 mt-1 whitespace-pre-wrap">{transcript}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function ImageAttachment({ attachment }: { attachment: Attachment }) {
  const stored = attachment.storageKey !== null;
  const [url, retry] = useAttachmentUrl(attachment.id, stored, true);
  const [zoom, setZoom] = useState(false);
  if (!stored) return <p className="m-0 text-xs text-muted">Imagen no disponible todavía (procesando)</p>;
  if (url.status === "error") {
    return (
      <button type="button" onClick={retry} className="cursor-pointer text-left text-xs font-semibold text-danger underline">
        No se pudo cargar la imagen. Reintentar
      </button>
    );
  }
  if (url.status !== "ready") return <p className="m-0 text-xs text-muted">Cargando imagen…</p>;
  return (
    <>
      <button type="button" onClick={() => setZoom(true)} aria-label="Ampliar imagen" className="block cursor-zoom-in border-0 bg-transparent p-0">
        <img src={url.url} alt="Imagen adjunta" loading="lazy" onError={retry} className="max-h-64 max-w-full rounded-xl object-cover" />
      </button>
      {zoom ? (
        <Modal title="Imagen" wide onClose={() => setZoom(false)}>
          <img src={url.url} alt="Imagen adjunta ampliada" className="max-h-[70dvh] w-full rounded-xl object-contain" />
        </Modal>
      ) : null}
    </>
  );
}

function DocumentAttachment({ attachment }: { attachment: Attachment }) {
  const stored = attachment.storageKey !== null;
  const [wanted, setWanted] = useState(false);
  const [url, retry] = useAttachmentUrl(attachment.id, stored, wanted);
  const size = attachment.sizeBytes ? ` · ${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB` : "";
  if (!stored) return <p className="m-0 text-xs text-muted">Documento no disponible todavía (procesando)</p>;
  const cls = "inline-flex cursor-pointer items-center gap-1.5 text-sm font-semibold underline";
  if (url.status === "ready") {
    return (
      <a href={url.url} target="_blank" rel="noopener noreferrer" download className={cls}>
        <FileText aria-hidden className="size-4" />
        Abrir documento{size}
      </a>
    );
  }
  return (
    <button type="button" disabled={url.status === "loading"} onClick={() => (url.status === "error" ? retry() : setWanted(true))} className={cls}>
      <FileText aria-hidden className="size-4" />
      {url.status === "error" ? "Error, reintentar" : url.status === "loading" ? "Preparando…" : `Descargar documento${size}`}
    </button>
  );
}

/** Renders one stored/pending attachment of a message. Returns null for kinds without a viewer. */
export function AttachmentView({ messageType, attachment }: { messageType: Message["type"]; attachment: Attachment }) {
  switch (attachmentKind(messageType, attachment.mimeType)) {
    case "audio":
      return <AudioAttachment attachment={attachment} />;
    case "image":
      return <ImageAttachment attachment={attachment} />;
    case "document":
      return <DocumentAttachment attachment={attachment} />;
    default:
      return null;
  }
}
