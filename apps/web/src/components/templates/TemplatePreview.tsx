import { renderPreview } from "@/lib/wa-templates";

/** WhatsApp-style bubble showing the body with the sample values filled in. */
export function TemplatePreview({ body, samples }: { body: string; samples: readonly string[] }) {
  const text = body.trim() === "" ? "Aquí verás cómo queda tu mensaje." : renderPreview(body, samples);
  return (
    <div className="rounded-[20px] bg-[#e5ddd5] p-4" aria-label="Vista previa del mensaje" data-testid="template-preview">
      <div className="max-w-[88%] rounded-[12px] rounded-tl-none bg-white px-3 py-2 text-[14px] leading-snug whitespace-pre-wrap shadow-sm">
        <span className={body.trim() === "" ? "text-muted" : undefined}>{text}</span>
      </div>
    </div>
  );
}
