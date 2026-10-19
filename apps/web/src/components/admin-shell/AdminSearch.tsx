"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useRef, useState } from "react";
import { useDialogBehavior } from "@/lib/hooks/use-dialog";
import { searchNav } from "./nav";

/** Global search dialog (Ctrl + K). Searches backoffice sections for now. */
export function AdminSearch({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [query, setQuery] = useState("");
  useDialogBehavior(ref, onClose);
  const results = searchNav(query);
  const goToFirst = (e: FormEvent) => {
    e.preventDefault();
    const first = results[0];
    if (!first) return;
    router.push(first.href);
    onClose();
  };
  return (
    <>
      <div onClick={onClose} aria-hidden className="fixed inset-0 z-[60] bg-ink/50" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Búsqueda global" tabIndex={-1} className="fixed top-[72px] left-1/2 z-[61] w-[min(640px,calc(100vw-24px))] -translate-x-1/2 overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_rgba(18,18,18,.3)]">
        <form role="search" onSubmit={goToFirst}>
          <label className="flex h-[60px] items-center gap-2.5 border-b border-line px-[18px]">
            <Search aria-hidden className="size-5 flex-none" />
            <input data-autofocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar una sección" aria-label="Buscar" className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none" />
            <span aria-hidden className="text-xs font-bold text-muted">Esc</span>
          </label>
        </form>
        <div className="max-h-[420px] overflow-y-auto p-2">
          {results.map(({ key, label, href, icon: Icon }) => (
            <Link key={key} href={href} onClick={onClose} className="flex items-center gap-3 rounded-[14px] p-2.5 text-ink no-underline hover:bg-paper">
              <span className="grid size-9 flex-none place-items-center rounded-[10px] bg-paper"><Icon aria-hidden className="size-[18px]" /></span>
              <b className="text-[14px]">{label}</b>
            </Link>
          ))}
          {results.length === 0 ? <div role="status" className="p-5 text-center text-muted">Sin resultados para “{query}”.</div> : null}
        </div>
      </div>
    </>
  );
}
