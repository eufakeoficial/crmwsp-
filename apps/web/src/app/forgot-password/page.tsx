"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/api";
import { errorMessage } from "@/lib/messages";

export default function ForgotPasswordPage() {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(undefined);
    setBusy(true);
    try {
      await api.forgotPassword({ email: String(form.get("email")) });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Recuperar contraseña" subtitle="Te enviaremos un enlace para crear una contraseña nueva.">
      {done ? (
        <p className="text-sm text-ink">
          Si el correo corresponde a una cuenta, recibirás un enlace en unos minutos. El enlace vence en 30 minutos y solo se puede
          usar una vez.
        </p>
      ) : (
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required />
          </div>
          <Alert>{error}</Alert>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
            {busy ? "Enviando…" : "Enviar enlace"}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-bold text-ink underline">
          Volver a iniciar sesión
        </Link>
      </p>
    </AuthShell>
  );
}
