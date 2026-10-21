"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { canManageAi } from "@/components/app/roles";
import { useSession } from "@/components/app/SessionProvider";
import { Alert, Button, Card, Spinner } from "@/components/ui";
import { simulatorApi } from "@/lib/ai-simulator-api";
import { errorMessage } from "@/lib/messages";
import {
  AI_SCENARIO_EXPECTATIONS,
  type AiScenario,
  type AiScenarioExpectation,
  type RunScenariosResponse,
  type SimulationMessage,
  type SimulationResult,
  type SimulationVerdict,
} from "@crmwsp/contracts";
import { SettingsFrame } from "./AccessGate";

const VERDICT_LABEL: Record<SimulationVerdict, string> = {
  auto: "Automática",
  needs_approval: "Requiere aprobación",
  blocked: "Bloqueada",
};
const VERDICT_TONE: Record<SimulationVerdict, string> = {
  auto: "bg-lime text-ink",
  needs_approval: "border border-ink bg-white text-ink",
  blocked: "bg-ink text-white",
};
const REPLY_LABEL = { send: "Se enviaría", draft: "Borrador para un humano", blocked: "Bloqueada" } as const;
const EXPECTATION_LABEL: Record<AiScenarioExpectation, string> = {
  must_handoff: "Debe derivar a un humano",
  must_not_handoff: "No debe derivar",
  must_reply: "Debe responder",
  must_cite_price: "Debe citar un precio",
  must_cite_knowledge: "Debe citar la base de conocimiento",
  must_not_quote: "No debe presupuestar",
  must_not_discount: "No debe ofrecer descuentos",
  must_need_approval: "Alguna acción debe requerir aprobación",
};

function SimulationDetails({ r }: { r: SimulationResult }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      {r.reply ? (
        <div>
          <b>Respuesta · {REPLY_LABEL[r.reply.outcome]}</b>
          <p className="m-0 text-ink-3">{r.reply.reason}</p>
          {r.reply.claims.length > 0 ? (
            <ul className="m-0 mt-1 pl-5">
              {r.reply.claims.map((c, i) => (
                <li key={i}>
                  <span className="font-semibold">[{c.kind}]</span> {c.text}
                  {c.citations.length === 0 ? <span className="text-ink-3"> · sin cita</span> : null}
                  {c.citations.map((ci) => (
                    <span key={ci.chunkId} className="block text-ink-3">
                      {ci.valid ? `Fuente: ${ci.sourceTitle ?? "sin título"} — “${ci.excerpt ?? ""}”` : `Cita inválida (${ci.chunkId})`}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <p className="m-0">La IA no propuso respuesta.</p>
      )}
      <div>
        <b>Acciones que tomaría</b>
        {r.actions.length === 0 ? <p className="m-0 text-ink-3">Ninguna.</p> : null}
        <ul className="m-0 mt-1 flex list-none flex-col gap-1 p-0">
          {r.actions.map((a, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${VERDICT_TONE[a.verdict]}`}>{VERDICT_LABEL[a.verdict]}</span>
              <code>{a.type}</code>
              <span className="text-ink-3">{a.reason}{a.addedByPolicy ? " (añadida por las políticas)" : ""}</span>
              {Object.keys(a.payload).length > 0 ? <code className="break-all text-xs text-ink-3">{JSON.stringify(a.payload)}</code> : null}
            </li>
          ))}
        </ul>
      </div>
      <p className="m-0 text-ink-3">
        {r.handoff ? "Derivaría a un humano. " : ""}Confianza {r.confidence.toFixed(2)} (umbral {r.confidenceThreshold.toFixed(2)}) · {r.retrievedChunks} fragmentos recuperados · prompt{" "}
        {r.promptSource === "draft" ? "borrador" : "activo"} · {r.model} · {r.usage.inputTokens + r.usage.outputTokens + r.usage.embeddingTokens} tokens ·{" "}
        {r.usage.priceKnown ? `≈ ${r.usage.costUsd.toFixed(5)} USD` : "coste desconocido"}
      </p>
    </div>
  );
}

function Chat({ draft }: { draft: string | undefined }) {
  const [messages, setMessages] = useState<SimulationMessage[]>([]);
  const [text, setText] = useState("");
  const [last, setLast] = useState<SimulationResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const next: SimulationMessage[] = [...messages, { author: "contact", text: t }];
    setBusy(true);
    setError(undefined);
    try {
      const r = await simulatorApi.simulate({ messages: next.slice(-20), ...(draft !== undefined ? { draftSystemPrompt: draft } : {}) });
      setLast(r);
      setMessages(r.reply && r.reply.outcome !== "blocked" ? [...next, { author: "ai", text: r.reply.text }] : next);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="m-0 text-[17px]">Conversación de prueba</h2>
        <button type="button" className="text-sm underline" onClick={() => { setMessages([]); setLast(undefined); }}>Reiniciar</button>
      </div>
      <p className="m-0 text-sm text-ink-3">Escribe como si fueras el cliente. No se envía nada por WhatsApp ni se guarda en el CRM; solo se consumen tokens.</p>
      <ol className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
        {messages.map((m, i) => (
          <li key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-[14px] px-3 py-2 text-sm ${m.author === "contact" ? "self-end bg-lime" : "self-start border border-line bg-white"}`}>
            {m.text}
          </li>
        ))}
      </ol>
      {last ? <SimulationDetails r={last} /> : null}
      <Alert>{error}</Alert>
      <form onSubmit={(e) => void send(e)} className="flex gap-2">
        <label htmlFor="sim-input" className="sr-only">Mensaje del cliente</label>
        <input id="sim-input" value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Hola, ¿cuánto cuesta…?" className="h-12 min-w-0 flex-1 rounded-[14px] border-[1.5px] border-ink px-3.5 text-[16px]" />
        <Button type="submit" variant="accent" disabled={busy || text.trim() === ""}>{busy ? <Spinner /> : null}Enviar</Button>
      </form>
    </Card>
  );
}

function Scenarios({ draft }: { draft: string | undefined }) {
  const [items, setItems] = useState<AiScenario[]>();
  const [run, setRun] = useState<RunScenariosResponse>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [name, setName] = useState("");
  const [msgs, setMsgs] = useState("");
  const [exp, setExp] = useState<AiScenarioExpectation[]>([]);

  const load = useCallback(async () => {
    try {
      setItems(await simulatorApi.listScenarios());
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => void load(), [load]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const create = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      const messages = msgs.split("\n").map((m) => m.trim()).filter(Boolean);
      await simulatorApi.createScenario({ name: name.trim(), messages, expectations: exp });
      setName("");
      setMsgs("");
      setExp([]);
      await load();
    });
  };
  const resultOf = (id: string) => run?.results.find((r) => r.scenarioId === id);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-[17px]">Escenarios de regresión</h2>
        <div className="flex gap-2">
          <Button type="button" variant="accent" disabled={busy || !items?.length} onClick={() => void act(async () => setRun(await simulatorApi.runScenarios(draft)))}>
            {busy ? <Spinner /> : null}Ejecutar todos
          </Button>
        </div>
      </div>
      {run ? <p className="m-0 text-sm"><b>{run.passed}</b> superados · <b>{run.failed}</b> fallidos</p> : null}
      <Alert>{error}</Alert>
      {items === undefined ? <p className="text-muted">Cargando…</p> : null}
      {items?.length === 0 ? (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="m-0">Aún no tienes escenarios.</p>
          <Button type="button" disabled={busy} onClick={() => void act(async () => setItems(await simulatorApi.installDefaults()))}>Cargar 5 escenarios de ejemplo</Button>
        </div>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items?.map((s) => {
          const r = resultOf(s.id);
          return (
            <li key={s.id} className="rounded-[14px] border border-line p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>{r ? (r.passed ? "✓ " : "✗ ") : ""}{s.name}</b>
                <button type="button" className="text-sm underline" disabled={busy} onClick={() => void act(async () => { await simulatorApi.deleteScenario(s.id); await load(); })}>Eliminar</button>
              </div>
              <p className="m-0 text-ink-3">{s.messages.join(" / ")}</p>
              <ul className="m-0 pl-5">
                {(r?.checks ?? s.expectations.map((e) => ({ expectation: e, passed: undefined, detail: "" }))).map((c) => (
                  <li key={c.expectation}>
                    {c.passed === undefined ? "" : c.passed ? "✓ " : "✗ "}{EXPECTATION_LABEL[c.expectation]}{c.detail ? ` — ${c.detail}` : ""}
                  </li>
                ))}
              </ul>
              {r?.error ? <p className="m-0 text-ink-3">Error: {r.error}</p> : null}
              {r?.simulation ? (
                <details className="mt-1"><summary>Ver detalle</summary><SimulationDetails r={r.simulation} /></details>
              ) : null}
            </li>
          );
        })}
      </ul>
      <form onSubmit={create} className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
        <b>Nuevo escenario</b>
        <label className="flex flex-col gap-1">Nombre<input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-10 rounded-[12px] border border-ink px-3" /></label>
        <label className="flex flex-col gap-1">Mensajes del cliente (uno por línea)<textarea value={msgs} onChange={(e) => setMsgs(e.target.value)} rows={3} className="rounded-[12px] border border-ink p-3" /></label>
        <fieldset className="m-0 flex flex-wrap gap-x-4 gap-y-1 border-0 p-0">
          <legend className="mb-1">Resultado esperado</legend>
          {AI_SCENARIO_EXPECTATIONS.map((e) => (
            <label key={e} className="flex items-center gap-1">
              <input type="checkbox" checked={exp.includes(e)} onChange={(ev) => setExp(ev.target.checked ? [...exp, e] : exp.filter((x) => x !== e))} />
              {EXPECTATION_LABEL[e]}
            </label>
          ))}
        </fieldset>
        <div><Button type="submit" disabled={busy || !name.trim() || !msgs.trim() || exp.length === 0}>Guardar escenario</Button></div>
      </form>
    </Card>
  );
}

function Body() {
  const [useDraft, setUseDraft] = useState(false);
  const [draft, setDraft] = useState("");
  const active = useDraft ? draft : undefined;
  return (
    <div className="flex max-w-[980px] flex-col gap-4">
      <Card className="flex flex-col gap-2 text-sm">
        <h2 className="m-0 text-[17px]">Prompt a probar</h2>
        <label className="flex items-center gap-2"><input type="radio" checked={!useDraft} onChange={() => setUseDraft(false)} />Configuración activa</label>
        <label className="flex items-center gap-2"><input type="radio" checked={useDraft} onChange={() => setUseDraft(true)} />Prompt borrador (sin guardar)</label>
        {useDraft ? (
          <textarea aria-label="Prompt borrador" value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} maxLength={8000} className="rounded-[12px] border border-ink p-3" />
        ) : null}
      </Card>
      <Chat draft={active} />
      <Scenarios draft={active} />
    </div>
  );
}

export function SimulatorView() {
  const { tenant } = useSession();
  return (
    <SettingsFrame title="Simulador de conversaciones" subtitle="Prueba tu bot antes de activarlo: nada se envía ni se guarda en el CRM.">
      {() => (canManageAi(tenant?.role) ? <Body /> : <Alert>Solo propietarios y administradores pueden usar el simulador.</Alert>)}
    </SettingsFrame>
  );
}
