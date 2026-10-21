"use client";

import { Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type JSX } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { buttonClasses, Card, StatusChip } from "@/components/ui";
import { aiApi, knowledgeApi } from "@/lib/ai-api";
import { computeCapabilityStatus, type AiCapabilityData } from "@/lib/ai-capabilities";
import { computeHubStatus, type AiHubData, type HubFeatureKey } from "@/lib/ai-hub-status";
import { ownerModeApi } from "@/lib/owner-mode-api";
import { playbookApi } from "@/lib/playbook-api";
import { voiceApi } from "@/lib/voice-api";
import { AiCapabilities } from "./AiCapabilities";
import { OrdersMock, OwnerMock, QuoteMock, SimulatorMock, SourcesMock, VoiceMock } from "./Mocks";

const FEATURES: readonly { key: HubFeatureKey; title: string; text: string; href: string; mock: () => JSX.Element }[] = [
  { key: "sources", title: "Respuestas con fuentes", text: "Responde 24/7 con tu catálogo y FAQ, y cita de dónde sale cada precio.", href: "/app/settings/knowledge", mock: SourcesMock },
  { key: "quotes", title: "Cotiza y cobra", text: "Arma presupuestos y links de pago, con tu aprobación antes de enviarlos.", href: "/app/settings/ai", mock: QuoteMock },
  { key: "orders", title: "Pedidos desde audio, foto o PDF", text: "Convierte lo que te envía el cliente en un pedido listo para revisar.", href: "/app/settings/ai", mock: OrdersMock },
  { key: "voice", title: "Respuestas por voz", text: "Contesta con notas de voz naturales usando tu cuenta de ElevenLabs.", href: "/app/settings/ai#voz", mock: VoiceMock },
  { key: "simulator", title: "Simulador", text: "Prueba el bot en conversaciones de ejemplo antes de activarlo.", href: "/app/settings/ai/simulator", mock: SimulatorMock },
  { key: "owner", title: "Modo dueño por WhatsApp", text: "Consulta ventas y gestiona el CRM desde tu propio WhatsApp.", href: "/app/settings/owner-mode", mock: OwnerMock },
];

const ok = <T,>(r: PromiseSettledResult<T>): T | undefined => (r.status === "fulfilled" ? r.value : undefined);

export function AiHubView() {
  const [data, setData] = useState<AiCapabilityData | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([aiApi.getConnection(), knowledgeApi.listSources(), voiceApi.get(), ownerModeApi.status(), aiApi.getAgentConfig(), playbookApi.get()]).then(([c, s, v, o, a, p]) => {
      if (live) setData({ connection: ok(c), sources: ok(s), voice: ok(v), owner: ok(o), agent: ok(a), playbook: ok(p) });
    });
    return () => {
      live = false;
    };
  }, []);

  const status = data ? computeHubStatus(data as AiHubData) : null;
  const capabilities = data ? computeCapabilityStatus(data) : null;
  const connected = Boolean(data?.connection);

  return (
    <div className="mx-auto max-w-[1080px]">
      <div className="flex items-start justify-between gap-3">
        <PageHeader title="IA de CRMWSP" subtitle="Tu vendedor por WhatsApp, siempre disponible." />
        <Link href="/app/settings/ai/simulator" className={buttonClasses("primary", "shrink-0")}>
          <Sparkles aria-hidden className="size-4" /> Probar IA
        </Link>
      </div>

      <div className="my-6 text-center">
        <p className="m-0 text-[13px] text-muted">Bienvenido a la IA de CRMWSP</p>
        <h2 className="mx-auto mt-1 mb-0 max-w-[620px] text-[clamp(24px,3.4vw,34px)] leading-[1.1] font-extrabold tracking-[-0.03em]">
          Tu vendedor por WhatsApp que cotiza y cobra
        </h2>
      </div>

      <AiCapabilities status={capabilities} />

      <div className="mt-8">
        <h2 className="m-0 mb-3 text-[19px]">Empieza por aquí</h2>
      </div>
      <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 md:grid-cols-2 desk:grid-cols-3">
        {FEATURES.map(({ key, title, text, href, mock: Mock }) => (
          <li key={key} className="flex">
            <Card className="flex w-full flex-col gap-3 p-3">
              <div aria-hidden className="flex h-[132px] flex-col justify-center rounded-xl bg-paper p-3">
                <Mock />
              </div>
              <div className="flex flex-1 flex-col gap-1.5 px-1">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="m-0 text-[15px] font-extrabold">{title}</h3>
                  {status ? <StatusChip label={status[key] ? "Activo" : "Sin configurar"} tone={status[key] ? "success" : "paper"} /> : null}
                </div>
                <p className="m-0 line-clamp-2 text-[13px] text-muted">{text}</p>
                <Link href={href} className="mt-auto pt-1 text-[13px] font-bold text-ink underline-offset-2 hover:underline">
                  Configurar →
                </Link>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {data ? (
        <div className="mt-6 flex justify-center">
          <Link href="/app/settings/ai" className={buttonClasses(connected ? "outline" : "primary", undefined, "lg")}>
            {connected ? "Ajustes avanzados" : "Conectar mi IA"}
          </Link>
        </div>
      ) : null}
    </div>
  );
}
