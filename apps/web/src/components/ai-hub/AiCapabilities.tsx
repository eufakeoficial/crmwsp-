import Link from "next/link";
import { Card, StatusChip } from "@/components/ui";
import { AI_CAPABILITIES, type CapabilityKey } from "@/lib/ai-capabilities";

/** "Qué hace tu IA": every AI capability with a one-line explanation, its status and a link. */
export function AiCapabilities({ status }: { status: Record<CapabilityKey, boolean | null> | null }) {
  return (
    <section aria-labelledby="ai-capabilities-title" className="mt-8">
      <h2 id="ai-capabilities-title" className="m-0 text-[19px]">
        Qué hace tu IA
      </h2>
      <p className="mt-1 mb-3 text-[13px] text-muted">Todo lo que puede hacer hoy, con un acceso directo a cada función.</p>
      <Card className="p-0">
        <ul className="m-0 flex list-none flex-col p-0">
          {AI_CAPABILITIES.map((c, i) => {
            const on = status?.[c.key];
            return (
              <li key={c.key} className={i === 0 ? "flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3" : "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-3"}>
                <div className="min-w-0 flex-1 basis-[260px]">
                  <h3 className="m-0 text-[15px] font-extrabold">{c.title}</h3>
                  <p className="m-0 text-[13px] text-muted">{c.text}</p>
                </div>
                {on === null || on === undefined ? null : <StatusChip label={on ? "Activo" : "Inactivo"} tone={on ? "success" : "paper"} />}
                <Link href={c.href} className="text-[13px] font-bold whitespace-nowrap text-ink underline-offset-2 hover:underline">
                  {c.linkLabel} →
                </Link>
              </li>
            );
          })}
        </ul>
      </Card>
    </section>
  );
}
