"use client";

import { Bot, CircleCheck, CircleSlash, Hand, Lock, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { type AiStatus, type AiStatusInput, type AiStatusKind, type AiStatusTone, computeAiStatus } from "@/lib/ai-status";
import { cn } from "@/lib/cn";

const TONE: Record<AiStatusTone, string> = {
  green: "border-success/30 bg-success-soft text-success",
  amber: "border-gold/60 bg-warning-soft text-warning",
  blue: "border-royal/25 bg-royal-soft text-royal",
  gray: "border-line-2 bg-paper text-ink-4",
};
const DOT: Record<AiStatusTone, string> = { green: "bg-success", amber: "bg-warning", blue: "bg-royal", gray: "bg-muted" };
const ICON: Record<AiStatusKind, typeof Bot> = {
  closed: Lock,
  handoff: Hand,
  assigned: UserRound,
  off: CircleSlash,
  assist: Sparkles,
  paused: Bot,
  active: CircleCheck,
};

/** Re-renders when the pause expires so the pill flips to "active" without a refresh. */
export function useAiStatus(input: AiStatusInput): AiStatus {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    setNow(new Date());
    if (!input.pausedUntil) return;
    const ms = new Date(input.pausedUntil).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return;
    const t = setTimeout(() => setNow(new Date()), Math.min(ms + 250, 2_147_000_000));
    return () => clearTimeout(t);
  }, [input.pausedUntil]);
  return computeAiStatus(input, now);
}

/** Single, unmistakable "will the AI answer?" indicator for the chat header. */
export function AiStatusPill({
  input,
  busy,
  onResume,
  onFocusMode,
}: {
  input: AiStatusInput;
  busy: boolean;
  onResume: () => void;
  /** Focuses the AI mode selector. */
  onFocusMode: () => void;
}) {
  const status = useAiStatus(input);
  const Icon = ICON[status.kind];
  return (
    <div role="status" data-testid="ai-status" data-tone={status.tone} className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-1.5">
      <button
        type="button"
        onClick={onFocusMode}
        title={status.reason}
        aria-label={`${status.label}. ${status.reason}`}
        className={cn("inline-flex min-h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-left text-[12px] font-bold", TONE[status.tone])}
      >
        {status.kind === "active" ? (
          <span aria-hidden className="relative flex size-2 flex-none">
            <span className={cn("absolute inline-flex size-full rounded-full opacity-60 motion-safe:animate-ping", DOT.green)} />
            <span className={cn("relative inline-flex size-2 rounded-full", DOT.green)} />
          </span>
        ) : null}
        <Icon aria-hidden className="size-3.5 flex-none" />
        <span className="min-w-0 truncate">{status.label}</span>
      </button>
      {status.canResume ? (
        <button
          type="button"
          disabled={busy}
          onClick={onResume}
          className="h-7 cursor-pointer rounded-full border border-warning bg-white px-3 text-[12px] font-bold text-warning hover:bg-warning-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reanudar IA ahora
        </button>
      ) : null}
    </div>
  );
}

/** Compact dot for list rows. */
export function AiStatusDot({ tone, label }: { tone: AiStatusTone; label: string }) {
  return <span role="img" aria-label={label} title={label} data-testid="ai-dot" data-tone={tone} className={cn("size-2.5 flex-none rounded-full", DOT[tone])} />;
}
