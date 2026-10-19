"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/api";
import { routeAfterAuth } from "@/lib/after-auth";
import { errorMessage } from "@/lib/messages";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(undefined);
    setBusy(true);
    try {
      const me = await api.login({ email: String(form.get("email")), password: String(form.get("password")) });
      router.replace(routeAfterAuth(me));
    } catch (err) {
      setError(errorMessage(err, "login"));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Iniciar sesión" subtitle="Accede a tu espacio de trabajo.">
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="font-medium text-emerald-700 underline dark:text-emerald-400">
          Regístrate
        </Link>
      </p>
    </AuthShell>
  );
}
