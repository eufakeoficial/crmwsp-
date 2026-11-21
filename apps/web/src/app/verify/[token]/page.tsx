"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ApiError, api } from "@/lib/api";
import { errorMessage } from "@/lib/messages";

type State = { kind: "verifying" } | { kind: "done" } | { kind: "expired" } | { kind: "error"; message: string };

export default function VerifyEmailPage() {
  const params = useParams<{ token: string }>();
  // Read once, then strip it from the address bar/history so it cannot leak (screenshots, history, Referer).
  const [token] = useState(() => String(params.token ?? ""));
  const [state, setState] = useState<State>({ kind: "verifying" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // single-use token: never send it twice (React strict mode)
    started.current = true;
    if (token && window.location.pathname !== "/verify") window.history.replaceState(null, "", "/verify");
    api
      .verifyEmail({ token })
      .then(() => setState({ kind: "done" }))
      .catch((err: unknown) =>
        setState(
          err instanceof ApiError && err.code === "VALIDATION_ERROR" ? { kind: "expired" } : { kind: "error", message: errorMessage(err) },
        ),
      );
  }, [token]);

  const title =
    state.kind === "done" ? "Correo confirmado" : state.kind === "verifying" ? "Confirmando tu correo…" : "No pudimos confirmar tu correo";
  return (
    <AuthShell title={title}>
      {state.kind === "done" ? (
        <p className="text-sm text-ink">Listo, tu correo quedó confirmado. Ya puedes conectar tu WhatsApp.</p>
      ) : state.kind === "expired" ? (
        <p className="text-sm text-ink">
          El enlace no es válido, ya se usó o venció. Entra a tu cuenta y pide uno nuevo desde Canales con «Reenviar correo».
        </p>
      ) : state.kind === "error" ? (
        <p className="text-sm text-ink">{state.message}</p>
      ) : null}
      {state.kind !== "verifying" ? (
        <p className="mt-6 text-center text-sm text-muted">
          <Link href="/app" className="font-bold text-ink underline">
            Ir a mi cuenta
          </Link>
        </p>
      ) : null}
    </AuthShell>
  );
}
