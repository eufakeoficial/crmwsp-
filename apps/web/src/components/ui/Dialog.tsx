"use client";

import { useId, useRef, useState } from "react";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";

/** Confirmation with a mandatory reason, for delicate actions (cancel, void, remove). */
export function ReasonDialog({
  title,
  description,
  fieldLabel = "Motivo (obligatorio)",
  options,
  confirmLabel = "Confirmar",
  minLength = 3,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  fieldLabel?: string;
  options?: readonly string[];
  confirmLabel?: string;
  minLength?: number;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [reason, setReason] = useState("");
  useDialogBehavior(ref, onCancel);
  const valid = options ? reason !== "" : reason.trim().length >= minLength;
  const field = "rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[14px] font-normal text-ink";
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/50 p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="flex w-full max-w-[420px] flex-col gap-2.5 rounded-3xl bg-white p-5">
        <b id={titleId} className="text-[19px]">{title}</b>
        {description ? <span className="text-ink-3">{description}</span> : null}
        <label className="flex flex-col gap-1 text-[13px] font-bold">
          {fieldLabel}
          {options ? (
            <select data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} className={`${field} h-11`}>
              <option value="">Elige un motivo</option>
              {options.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </select>
          ) : (
            <textarea data-autofocus value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className={`${field} resize-y py-2`} />
          )}
        </label>
        <div className="grid grid-cols-[1fr_1.3fr] gap-2">
          <button type="button" onClick={onCancel} className="h-[46px] cursor-pointer rounded-full border-[1.5px] border-ink bg-white font-bold text-ink">
            Cancelar
          </button>
          <button
            type="button"
            disabled={!valid}
            onClick={() => onConfirm(options ? reason : reason.trim())}
            className="h-[46px] cursor-pointer rounded-full bg-danger font-bold text-white disabled:cursor-not-allowed disabled:bg-line disabled:text-muted"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
