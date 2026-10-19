import { Camera, Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** "Upload a file" button: dashed until done, green afterwards. Visual only; wiring is up to the caller. */
export function UploadTile({ title, hint, done, onPick }: { title: string; hint: string; done: boolean; onPick: () => void }) {
  const Icon = done ? Check : Camera;
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn("flex min-h-[88px] cursor-pointer items-center gap-3.5 rounded-[22px] border-2 border-ink px-4 py-3.5 text-left text-ink", done ? "bg-success-soft" : "border-dashed bg-white")}
    >
      <span className={cn("grid size-[52px] flex-none place-items-center rounded-[14px]", done ? "bg-success text-white" : "bg-paper")}>
        <Icon aria-hidden className="size-6" />
      </span>
      <span className="flex-1">
        <b className="block">{title}</b>
        <span className="text-sm text-ink-3">{done ? "Subido · toca para cambiar" : hint}</span>
      </span>
    </button>
  );
}
