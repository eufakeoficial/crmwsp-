"use client";

import { useEffect, useState } from "react";
import type { BusinessCategoryOption, BusinessCategoryState } from "@crmwsp/contracts";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { errorMessage } from "@/lib/messages";
import { categoriesApi } from "@/lib/policies-api";

/**
 * Business category prompt (ADR 0021). Tenants created before T1 have no category: they are asked
 * here, never blocked. Pending/rejected reviews explain why WhatsApp cannot be connected yet.
 */
export function BusinessCategoryBanner() {
  const { tenant } = useSession();
  const allowed = canManageAi(tenant?.role);
  const [state, setState] = useState<BusinessCategoryState>();
  const [options, setOptions] = useState<BusinessCategoryOption[]>([]);
  const [choice, setChoice] = useState("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed) return;
    categoriesApi.state().then(setState, () => undefined);
  }, [allowed, tenant?.id]);
  useEffect(() => {
    if (state?.category === null) categoriesApi.list().then((r) => setOptions(r.items), () => undefined);
  }, [state?.category]);

  if (!state) return null;
  if (state.reviewStatus === "pending") {
    return (
      <div role="status" className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">
        Tu rubro ({state.label ?? state.category}) está en revisión. Podrás conectar WhatsApp cuando lo aprobemos.
      </div>
    );
  }
  if (state.reviewStatus === "rejected") {
    return (
      <div role="status" className="mb-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
        Tu rubro no fue aprobado para WhatsApp Business{state.reviewReason ? `: ${state.reviewReason}` : "."}
      </div>
    );
  }
  if (state.category !== null) return null;

  const chosen = options.find((o) => o.key === choice);
  const save = () => {
    if (!choice) return;
    setBusy(true);
    setError(undefined);
    categoriesApi
      .set({ category: choice, ...(detail.trim() ? { detail: detail.trim() } : {}) })
      .then(setState, (err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div role="status" className="mb-3 flex flex-col gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
      <span className="font-semibold">Indica el rubro de tu negocio para cumplir las políticas de WhatsApp Business.</span>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Rubro del negocio"
          className="h-9 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[13px] text-ink"
          value={choice}
          onChange={(e) => setChoice(e.target.value)}
        >
          <option value="">Elige una opción…</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        {chosen && (chosen.action === "review" || chosen.key === "otro") ? (
          <input
            aria-label="Detalle del rubro"
            className="h-9 rounded-xl border-[1.5px] border-ink bg-white px-2.5 text-[13px] text-ink"
            maxLength={200}
            placeholder="¿Qué vendes?"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
          />
        ) : null}
        <button type="button" className="rounded-xl bg-ink px-3 py-1.5 font-semibold text-white disabled:opacity-50" disabled={!choice || busy || chosen?.action === "block"} onClick={save}>
          Guardar
        </button>
      </div>
      {chosen?.action === "block" ? <span className="font-semibold text-red-700">Este rubro no está permitido por las políticas de WhatsApp Business.</span> : null}
      {chosen?.action === "review" ? <span>Requiere revisión manual antes de conectar nuevos números.</span> : null}
      {chosen?.guidance ? <span>{chosen.guidance}</span> : null}
      {error ? <span className="font-semibold text-red-700">{error}</span> : null}
    </div>
  );
}
