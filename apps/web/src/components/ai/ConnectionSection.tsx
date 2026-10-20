"use client";

import { Plug, Trash2 } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Alert, Button, Card, Input, Label, Modal, Spinner, Toast } from "@/components/ui";
import { aiApi } from "@/lib/ai-api";
import type { AiConnection, AiProvider, AiTestResult, AiUsage } from "@/lib/ai-schemas";
import { PROVIDER_BASE_URLS, fromMinor, toMinor, validateBaseUrl } from "@/lib/ai-validation";
import { useToast } from "@/lib/hooks/use-toast";
import { errorMessage } from "@/lib/messages";
import { BudgetFields } from "./BudgetFields";
import { KeyGuide } from "./KeyGuide";
import { ProviderPicker } from "./ProviderPicker";
import { PROVIDER_GUIDES } from "./provider-guides";
import { TestResult } from "./TestResult";

function StepCard({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-4 sm:p-6">
      <h2 className="m-0 flex items-center gap-3 text-[19px]">
        <span aria-hidden className="grid size-8 flex-none place-items-center rounded-full bg-ink text-sm font-extrabold text-white">{n}</span>
        {title}
      </h2>
      {children}
    </Card>
  );
}

/** Steps 1-4 of Configuración → IA. The API key lives only in component state and is cleared after saving. */
export function ConnectionSection({ connection, usage, canEdit, onChanged }: { connection: AiConnection | null; usage: AiUsage | null; canEdit: boolean; onChanged: () => void }) {
  const [provider, setProvider] = useState<AiProvider>(connection?.provider ?? "openai");
  const [baseUrl, setBaseUrl] = useState(connection?.provider === "custom" ? connection.baseUrl : "");
  const [apiKey, setApiKey] = useState("");
  const [cheap, setCheap] = useState(connection?.modelCheap ?? "");
  const [strong, setStrong] = useState(connection?.modelStrong ?? "");
  const [budget, setBudget] = useState(connection?.monthlyBudgetMinor ? fromMinor(connection.monthlyBudgetMinor) : "");
  const [currency, setCurrency] = useState(connection?.budgetCurrency ?? "EUR");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string>();
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { message, show } = useToast();
  const guide = PROVIDER_GUIDES[provider];

  useEffect(() => {
    if (!cheap && guide.cheapModels[0]) setCheap(guide.cheapModels[0]);
    if (!strong && guide.strongModels[0]) setStrong(guide.strongModels[0]);
  }, [guide, cheap, strong]);

  function pick(p: AiProvider) {
    setProvider(p);
    setTest(null);
    const g = PROVIDER_GUIDES[p];
    setCheap(g.cheapModels[0] ?? "");
    setStrong(g.strongModels[0] ?? "");
  }

  /** Validates and saves; returns false (with an error shown) when the form is invalid. */
  async function save(): Promise<boolean> {
    setError(undefined);
    let url: string | undefined;
    if (provider === "custom") {
      const check = validateBaseUrl(baseUrl);
      if (!check.ok) return (setError(check.reason), false);
      url = check.url;
    } else url = PROVIDER_BASE_URLS[provider];
    if (!connection && !apiKey.trim()) return (setError("Pega tu API key para conectar."), false);
    if (!cheap.trim() || !strong.trim()) return (setError("Indica el modelo barato y el modelo potente."), false);
    const budgetMinor = budget.trim() ? toMinor(budget) : undefined;
    if (budget.trim() && budgetMinor === undefined) return (setError("El límite mensual debe ser un número."), false);
    try {
      await aiApi.saveConnection({ provider, baseUrl: url, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}), modelCheap: cheap.trim(), modelStrong: strong.trim(), ...(budgetMinor !== undefined ? { monthlyBudgetMinor: budgetMinor, budgetCurrency: currency } : {}) });
      setApiKey("");
      onChanged();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    if (await save()) show("Configuración de IA guardada");
    setBusy(null);
  }

  async function onTest() {
    setBusy("test");
    setTest(null);
    if (await save()) {
      try {
        setTest(await aiApi.testConnection());
        onChanged();
      } catch (err) {
        setError(errorMessage(err));
      }
    }
    setBusy(null);
  }

  async function onDelete() {
    setConfirmDelete(false);
    try {
      await aiApi.deleteConnection();
      setTest(null);
      setCheap("");
      setStrong("");
      onChanged();
      show("Conexión eliminada");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const ro = !canEdit;
  const lastTest = test ?? (connection?.lastTestedAt && connection.lastTestOk !== null ? { ok: connection.lastTestOk, capabilities: connection.capabilities, latencyMs: 0 } : null);
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <StepCard n={1} title="Elige tu proveedor">
        <ProviderPicker value={provider} onChange={pick} disabled={ro} />
        {provider === "custom" ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-base-url">URL base (https)</Label>
            <Input id="ai-base-url" type="url" autoComplete="off" placeholder="https://api.miproveedor.com/v1" value={baseUrl} disabled={ro} onChange={(e) => setBaseUrl(e.target.value)} />
          </div>
        ) : null}
      </StepCard>
      <StepCard n={2} title={`Consigue tu API key de ${guide.label}`}>
        <KeyGuide provider={provider} />
      </StepCard>
      <StepCard n={3} title="Conecta y prueba">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ai-key">API key</Label>
          <Input id="ai-key" type="password" autoComplete="off" spellCheck={false} placeholder={connection?.apiKeyHint ? `Guardada (${connection.apiKeyHint}). Pega otra para cambiarla` : "sk-…"} value={apiKey} disabled={ro} onChange={(e) => setApiKey(e.target.value)} />
          <span className="text-xs text-muted">Se guarda cifrada y no se vuelve a mostrar{connection?.apiKeyHint ? `; solo verás ${connection.apiKeyHint}` : ""}.</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-cheap">Modelo barato (respuestas habituales)</Label>
            <Input id="ai-cheap" list="ai-cheap-list" autoComplete="off" value={cheap} disabled={ro} onChange={(e) => setCheap(e.target.value)} />
            <datalist id="ai-cheap-list">{guide.cheapModels.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-strong">Modelo potente (casos difíciles)</Label>
            <Input id="ai-strong" list="ai-strong-list" autoComplete="off" value={strong} disabled={ro} onChange={(e) => setStrong(e.target.value)} />
            <datalist id="ai-strong-list">{guide.strongModels.map((m) => <option key={m} value={m} />)}</datalist>
          </div>
        </div>
        {lastTest ? <TestResult result={lastTest} /> : null}
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void onTest()} disabled={busy !== null}>
              {busy === "test" ? <Spinner /> : <Plug aria-hidden className="size-4" />}Probar conexión
            </Button>
            {connection ? (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy !== null}>
                <Trash2 aria-hidden className="size-4" />Quitar conexión
              </Button>
            ) : null}
          </div>
        ) : null}
      </StepCard>
      <StepCard n={4} title="Fija un límite de gasto mensual">
        <BudgetFields budget={budget} currency={currency} usage={usage} disabled={ro} onBudget={setBudget} onCurrency={setCurrency} />
      </StepCard>
      <Alert>{error}</Alert>
      {canEdit ? (
        <div><Button type="submit" variant="accent" disabled={busy !== null}>{busy === "save" ? <Spinner /> : null}Guardar conexión</Button></div>
      ) : (
        <p className="m-0 text-sm text-muted">Solo propietarios y administradores pueden cambiar esta configuración.</p>
      )}
      {confirmDelete ? (
        <Modal title="¿Quitar la conexión de IA?" onClose={() => setConfirmDelete(false)} footer={<><Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button variant="primary" onClick={() => void onDelete()}>Quitar conexión</Button></>}>
          <p className="m-0">Se borrará la API key guardada y la IA dejará de responder. El inbox seguirá funcionando.</p>
        </Modal>
      ) : null}
      <Toast message={message} />
    </form>
  );
}
