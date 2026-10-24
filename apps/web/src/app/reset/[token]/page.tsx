"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Label, PasswordInput } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { errorMessage } from "@/lib/messages";

export default function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token ?? "");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const password = String(form.get("password"));
    setError(undefined);
    if (password.length < 10) return setError("La contraseña debe tener al menos 10 caracteres.");
    if (password !== String(form.get("confirm"))) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    try {
      await api.resetPassword({ token, password });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "VALIDATION_ERROR"
          ? "El enlace no es válido o ya venció. Solicita uno nuevo."
          : errorMessage(err),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Crear contraseña nueva" subtitle="Elige una contraseña de al menos 10 caracteres.">
      {done ? (
        <p className="text-sm text-ink">
          Listo, tu contraseña cambió. Por seguridad cerramos todas tus sesiones abiertas.{" "}
          <Link href="/login" className="font-bold underline">
            Inicia sesión
          </Link>
          .
        </p>
      ) : (
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="password">Contraseña nueva</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="confirm">Repite la contraseña</Label>
            <PasswordInput id="confirm" name="confirm" autoComplete="new-password" minLength={10} required />
          </div>
          <Alert>{error}</Alert>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
            {busy ? "Guardando…" : "Guardar contraseña"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/forgot-password" className="font-bold text-ink underline">
          Solicitar otro enlace
        </Link>
      </p>
    </AuthShell>
  );
}
