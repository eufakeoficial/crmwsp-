"use client";

import type { Channel } from "@crmwsp/contracts";
import { e164PhoneSchema } from "@crmwsp/contracts";
import Link from "next/link";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/app/EmptyState";
import { Alert, Button, Card, Input, Label } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { parseDialog360Callback, type Dialog360CallbackParams } from "@/lib/dialog360";
import { channelsApi } from "@/lib/inbox-api";
import { channelErrorMessage } from "@/lib/messages";

type State =
  | { kind: "working" }
  | { kind: "invalid" }
  | { kind: "needs-phone" }
  | { kind: "error"; message: string }
  | { kind: "done"; channels: Channel[] };

/** Receives the 360dialog Connect redirect (?client=...&channels=[...]) and finishes the onboarding. */
export function Dialog360Callback() {
  const [state, setState] = useState<State>({ kind: "working" });
  const [phone, setPhone] = useState("");
  const params = useRef<Dialog360CallbackParams | null>(null);
  const started = useRef(false);

  const connect = useCallback(async (phoneE164?: string) => {
    const p = params.current;
    if (!p) return;
    setState({ kind: "working" });
    try {
      const res = await channelsApi.connect360dialog({
        ...(p.clientId ? { clientId: p.clientId } : {}),
        channelIds: p.channelIds,
        ...(phoneE164 ? { phoneE164 } : {}),
      });
      setState({ kind: "done", channels: res.items });
    } catch (err) {
      // 400 with the phone message: the Hub did not expose the number; ask for it once.
      if (err instanceof ApiError && err.status === 400 && !phoneE164 && p.channelIds.length === 1) {
        setState({ kind: "needs-phone" });
        return;
      }
      setState({ kind: "error", message: channelErrorMessage(err) });
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const parsed = parseDialog360Callback(window.location.search);
    if (parsed.channelIds.length === 0) {
      setState({ kind: "invalid" });
      return;
    }
    params.current = parsed;
    void connect();
  }, [connect]);

  function submitPhone(e: FormEvent) {
    e.preventDefault();
    const parsed = e164PhoneSchema.safeParse(phone.trim());
    if (!parsed.success) {
      setState({ kind: "error", message: "El teléfono va en formato internacional (+5491155551234)." });
      return;
    }
    void connect(parsed.data);
  }

  return (
    <>
      <PageHeader title="Conectando con 360dialog" subtitle="Terminamos de enlazar tu número de WhatsApp Business." />
      <Card className="flex flex-col gap-3">
        {state.kind === "working" ? <p className="m-0 text-muted" aria-busy="true">Conectando tu número…</p> : null}
        {state.kind === "invalid" ? (
          <>
            <Alert>No recibimos ningún canal de 360dialog. Vuelve a Canales e inicia la conexión otra vez.</Alert>
            <Link href="/app/channels" className="font-semibold underline">Volver a Canales</Link>
          </>
        ) : null}
        {state.kind === "needs-phone" ? (
          <form onSubmit={submitPhone} className="flex flex-col gap-3" noValidate>
            <p className="m-0 text-sm">No pudimos leer el número desde 360dialog. Escríbelo para terminar.</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="d360-phone">Teléfono (formato internacional)</Label>
              <Input id="d360-phone" data-autofocus inputMode="tel" autoComplete="off" placeholder="+5491155551234" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </div>
            <div><Button type="submit" variant="whatsapp">Terminar conexión</Button></div>
          </form>
        ) : null}
        {state.kind === "error" ? (
          <>
            <Alert>{state.message}</Alert>
            <Link href="/app/channels" className="font-semibold underline">Volver a Canales</Link>
          </>
        ) : null}
        {state.kind === "done" ? (
          <>
            <p className="m-0">
              Listo: {state.channels.map((c) => c.phoneE164).join(", ")} {state.channels.length > 1 ? "están activos" : "está activo"}. Tu app de WhatsApp Business sigue funcionando y los mensajes también llegarán al Inbox.
            </p>
            <Link href="/app/channels" className="font-semibold underline">Ir a Canales</Link>
          </>
        ) : null}
      </Card>
    </>
  );
}
