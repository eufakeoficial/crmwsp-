import { ImageIcon, PlayCircle } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/cn";

export interface MediaSlotProps {
  kind: "image" | "video";
  alt: string;
  /** Public path or https URL. Empty/undefined renders the dashed placeholder. */
  src?: string;
  poster?: string;
  /** Placeholder text describing what to put here. */
  label?: string;
  width: number;
  height: number;
  className?: string;
  priority?: boolean;
  sizes?: string;
}

/** Image or video slot. Shows a dashed placeholder until `src` is provided. */
export function MediaSlot({ kind, alt, src, poster, label, width, height, className, priority = false, sizes = "(min-width: 1100px) 640px, 100vw" }: MediaSlotProps) {
  const frame = cn("relative w-full overflow-hidden rounded-[22px] border border-line bg-paper-2", className);
  const style = { aspectRatio: `${width} / ${height}` };

  // A video without a file yet still shows its poster as a still image.
  if (!src && kind === "video" && poster) {
    return (
      <div style={style} className={frame}>
        <Image src={poster} alt={alt} fill sizes={sizes} priority={priority} className="object-cover" />
      </div>
    );
  }

  if (!src) {
    const Icon = kind === "video" ? PlayCircle : ImageIcon;
    return (
      <div role="img" aria-label={`Espacio reservado: ${label ?? alt}`} style={style} className={cn(frame, "grid place-items-center border-2 border-dashed border-line-2 p-4 text-center")}>
        <div className="flex max-w-[34ch] flex-col items-center gap-2 text-muted">
          <Icon aria-hidden className="size-8" />
          <span className="text-sm font-semibold">{label ?? alt}</span>
          <span className="text-xs">{width}×{height}</span>
        </div>
      </div>
    );
  }

  if (kind === "video") {
    return (
      <div style={style} className={frame}>
        <video controls playsInline preload="metadata" poster={poster || undefined} aria-label={alt} className="size-full object-cover">
          <source src={src} />
        </video>
      </div>
    );
  }

  return (
    <div style={style} className={frame}>
      <Image src={src} alt={alt} fill sizes={sizes} priority={priority} unoptimized={src.startsWith("http")} className="object-cover" />
    </div>
  );
}
