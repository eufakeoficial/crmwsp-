"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { canManageAi } from "@/components/app/roles";
import { PageHeader } from "@/components/app/EmptyState";
import { useSession } from "@/components/app/SessionProvider";
import { TestResult } from "@/components/ai/TestResult";
import { Alert, Button, Card, Input, Label, Spinner, StepBars, Textarea, Toast, buttonClasses } from "@/components/ui";
import { aiApi, knowledgeApi } from "@/lib/ai-api";
import { ApiError } from "@/lib/api";
import { botTemplatesApi } from "@/lib/bot-templates-api";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import {
  EMPTY_PROGRESS,
  ONBOARDING_STEPS,
  type OnboardingProgress,
  type OnboardingStatus,
  type OnboardingStep,
  fetchOnboardingStatus,
  loadProgress,
  saveProgress,
  stepDone,
} from "@/lib/onboarding-api";
import type { AiTestResult, BotTemplate, BotTemplateIndustry } from "@crmwsp/contracts";
import { PricesStep } from "./PricesStep";

const TITLES: Record<OnboardingStep, string> = {
  business: "Tu negocio",
  prices: "Sube tu lista de precios",
  faq: "Preguntas frecuentes",
  ai: "Conecta tu IA",
  whatsapp: "Conecta WhatsApp",
  test: "Prueba tu bot",
};

const INDUSTRIES: Record<BotTemplateIndustry, string> = {
  health: "Salud y bienestar",
  home: "Hogar y reformas",
  events: "Eventos",
  retail: "Comercio y tienda",
  education: "Educación",
  real_estate: "Inmobiliaria",
};

type Ctx = { markDone: (s: OnboardingStep) => void; refresh: () => void; show: (m: string) => void };

function BusinessStep({ markDone, show }: Ctx) {
  const [templates, setTemplates] = useState<BotTemplate[]>();
  const [industry, setIndustry] = useState<BotTemplateIndustry>();
  const [needsOverwrite, setNeedsOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    botTemplatesApi.list().then(setTemplates, (err: unknown) => setError(errorMessage(err)));
  }, []);

  const template = templates?.find((t) => t.industry === industry);
  const available = new Set(templates?.map((t) => t.industry));

  async function apply(overwrite: boolean) {
    if (!template) return;
    setBusy(true);
    setError(undefined);
    try {
      await botTemplatesApi.apply(template.id, overwrite);
      setNeedsOverwrite(false);
      markDone("business");
      show(`Plantilla «${template.name}» aplicada`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && !overwrite) setNeedsOverwrite(true);
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!templates && !error) return <p className="m-0 text-muted" aria-busy="true">Cargando plantillas…</p>;
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">Elige tu sector y preparamos el agente con una plantilla que podrás editar.</p>
      <div role="radiogroup" aria-label="Sector" className="flex flex-wrap gap-2">
        {(Object.keys(INDUSTRIES) as BotTemplateIndustry[]).filter((k) => available.has(k)).map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={industry === k}
            onClick={() => { setIndustry(k); setNeedsOverwrite(false); }}
            className={buttonClasses(industry === k ? "primary" : "outline")}
          >
            {INDUSTRIES[k]}
          </button>
        ))}
      </div>
      {template ? <p className="m-0 text-sm">Plantilla: <b>{template.name}</b>. {template.description}</p> : null}
      {needsOverwrite ? <Alert>Tu agente ya tiene un prompt. Aplicar la plantilla lo reemplazará (queda en el historial de versiones).</Alert> : null}
      <Alert>{error}</Alert>
      <div>
        <Button variant="accent" disabled={!template || busy} onClick={() => void apply(needsOverwrite)}>
          {busy ? <Spinner /> : null}{needsOverwrite ? "Reemplazar y aplicar" : "Aplicar plantilla"}
        </Button>
      </div>
    </div>
  );
}

function FaqStep({ refresh, show }: Ctx) {
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("Preguntas frecuentes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const pdf = useRef<HTMLInputElement>(null);

  async function run(fn: () => Promise<unknown>, msg: string) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      show(msg);
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">Pega tus preguntas y respuestas (pregunta, salto de línea, respuesta) o sube un PDF.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ob-faq-title">Título</Label>
        <Input id="ob-faq-title" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ob-faq">Contenido</Label>
        <Textarea id="ob-faq" rows={7} value={content} onChange={(e) => setContent(e.target.value)} />
      </div>
      <Alert>{error}</Alert>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="accent"
          disabled={busy || !content.trim() || !title.trim()}
          onClick={() => void run(async () => { await knowledgeApi.createSource({ kind: "faq", title: title.trim(), content }); setContent(""); }, "Preguntas añadidas")}
        >
          {busy ? <Spinner /> : null}Añadir preguntas
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => pdf.current?.click()}>Subir PDF</Button>
        <input ref={pdf} type="file" hidden accept=".pdf,application/pdf" data-testid="faq-pdf-input" onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void run(() => knowledgeApi.createSource({ kind: "pdf", file: f }), `${f.name} subido`);
        }} />
      </div>
    </div>
  );
}

function AiStep({ refresh }: Ctx) {
  const [result, setResult] = useState<AiTestResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function test() {
    setBusy(true);
    setError(undefined);
    try {
      setResult(await aiApi.testConnection());
      refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">Tu IA usa tu propia clave (OpenAI u otro proveedor compatible). Pégala en Ajustes de IA y vuelve aquí.</p>
      <div className="flex flex-wrap gap-2">
        <Link href="/app/settings/ai" className={buttonClasses("accent")}>Configurar clave de IA</Link>
        <Button variant="outline" disabled={busy} onClick={() => void test()}>{busy ? <Spinner /> : null}Probar conexión</Button>
      </div>
      <Alert>{error}</Alert>
      {result ? <TestResult result={result} /> : null}
    </div>
  );
}

function WhatsappStep() {
  return (
    <div className="flex flex-col gap-3">
      <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
        <li>Crea una app de WhatsApp en la consola de Gupshup.</li>
        <li>En Canales, conecta tu número con el nombre de la app y su API key.</li>
        <li>Pega la URL de webhook que te mostramos en Gupshup (Callback URL).</li>
      </ol>
      <div><Link href="/app/channels" className={buttonClasses("accent")}>Ir a Canales</Link></div>
    </div>
  );
}

function TestStep({ markDone }: Ctx) {
  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-sm text-muted">Haz unas preguntas de ejemplo en el simulador antes de activar el bot con clientes reales.</p>
      <div>
        <Link href="/app/settings/ai/simulator" onClick={() => markDone("test")} className={buttonClasses("accent")}>Abrir el simulador</Link>
      </div>
    </div>
  );
}

const BODY: Record<OnboardingStep, (c: Ctx) => ReactNode> = {
  business: (c) => <BusinessStep {...c} />,
  prices: (c) => <PricesStep onImported={(m) => { c.markDone("prices"); c.show(m); c.refresh(); }} />,
  faq: (c) => <FaqStep {...c} />,
  ai: (c) => <AiStep {...c} />,
  whatsapp: () => <WhatsappStep />,
  test: (c) => <TestStep {...c} />,
};

function Wizard({ tenantId, canEdit }: { tenantId: string; canEdit: boolean }) {
  const router = useRouter();
  const [progress, setProgress] = useState<OnboardingProgress>(EMPTY_PROGRESS);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<OnboardingStatus | null>(null);
  const { message, show } = useToast();

  useEffect(() => {
    setProgress(loadProgress(tenantId) ?? EMPTY_PROGRESS);
    setReady(true);
  }, [tenantId]);
  const refresh = useCallback(() => {
    void fetchOnboardingStatus().then(setStatus);
  }, []);
  useEffect(refresh, [refresh]);

  const update = useCallback(
    (patch: (p: OnboardingProgress) => OnboardingProgress) => {
      setProgress((p) => {
        const next = patch(p);
        saveProgress(tenantId, next);
        return next;
      });
    },
    [tenantId],
  );

  if (!ready) return <p className="text-muted" aria-busy="true">Cargando…</p>;
  const step = ONBOARDING_STEPS[progress.current]!;
  const last = progress.current === ONBOARDING_STEPS.length - 1;
  const ctx: Ctx = { markDone: (s) => update((p) => ({ ...p, done: { ...p.done, [s]: true } })), refresh, show };

  return (
    <div className="flex max-w-[760px] flex-col gap-4">
      <PageHeader title="Puesta en marcha" subtitle="De tu lista de precios a un bot funcionando, paso a paso." />
      <div className="flex flex-col gap-2">
        <StepBars total={ONBOARDING_STEPS.length} current={progress.current + 1} />
        <p className="m-0 text-[13px] text-muted">Paso {progress.current + 1} de {ONBOARDING_STEPS.length}</p>
      </div>
      <nav aria-label="Pasos" className="flex flex-wrap gap-1.5">
        {ONBOARDING_STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-current={i === progress.current ? "step" : undefined}
            onClick={() => update((p) => ({ ...p, current: i }))}
            className={buttonClasses(i === progress.current ? "primary" : "outline", undefined, "sm")}
          >
            {stepDone(s, status, progress) ? <Check aria-hidden className="size-3.5" /> : null}
            {TITLES[s]}
          </button>
        ))}
      </nav>
      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-[17px]">{TITLES[step]}</h2>
        {canEdit ? BODY[step](ctx) : <Alert>Solo propietarios y administradores pueden configurar esto.</Alert>}
      </Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => { update((p) => ({ ...p, dismissed: true })); router.push("/app"); }}>Omitir por ahora</Button>
        <div className="flex gap-2">
          <Button variant="outline" disabled={progress.current === 0} onClick={() => update((p) => ({ ...p, current: p.current - 1 }))}>Anterior</Button>
          {last ? (
            <Button variant="accent" onClick={() => { update((p) => ({ ...p, dismissed: true })); router.push("/app"); }}>Terminar</Button>
          ) : (
            <Button variant="accent" onClick={() => update((p) => ({ ...p, current: p.current + 1 }))}>Siguiente</Button>
          )}
        </div>
      </div>
      <Toast message={message} />
    </div>
  );
}

export function OnboardingWizard() {
  const { tenant } = useSession();
  if (!tenant) return null;
  return <Wizard key={tenant.id} tenantId={tenant.id} canEdit={canManageAi(tenant.role)} />;
}
