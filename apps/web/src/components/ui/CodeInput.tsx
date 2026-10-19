"use client";

import { useRef } from "react";

/** One-time code input: one box per digit, paste-friendly, backspace moves back. */
export function CodeInput({ length = 6, label, onChange }: { length?: number; label: string; onChange?: (code: string) => void }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const read = () => refs.current.map((r) => r?.value ?? "").join("");
  return (
    <div role="group" aria-label={label} className="flex gap-2">
      {Array.from({ length }, (_, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          maxLength={1}
          aria-label={`${label}, dígito ${i + 1}`}
          className="h-14 w-11 rounded-[14px] border-[1.5px] border-ink bg-white text-center text-[22px] font-extrabold text-ink"
          onChange={(e) => {
            e.target.value = e.target.value.replace(/\D/g, "").slice(0, 1);
            if (e.target.value) refs.current[i + 1]?.focus();
            onChange?.(read());
          }}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !e.currentTarget.value) refs.current[i - 1]?.focus();
          }}
          onPaste={(e) => {
            const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
            if (!digits) return;
            e.preventDefault();
            [...digits].forEach((d, k) => {
              const el = refs.current[k];
              if (el) el.value = d;
            });
            refs.current[Math.min(digits.length, length - 1)]?.focus();
            onChange?.(read());
          }}
        />
      ))}
    </div>
  );
}
