"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label, PasswordInput } from "@/components/ui";
import { api } from "@/lib/api";
import { postAuthDestination, routeAfterAuth } from "@/lib/after-auth";
import { platformApi } from "@/lib/platform-api";
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
      const route = routeAfterAuth(me);
      const next = new URLSearchParams(window.location.search).get("next");
      const isPlatformAdmin = next ? false : await platformApi.me().then((r) => r.isPlatformAdmin, () => false);
      router.replace(postAuthDestination(route, { next, isPlatformAdmin }));
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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Contraseña</Label>
            <Link href="/forgot-password" className="text-sm text-muted underline">
              ¿Olvidaste tu contraseña?
            </Link>
          </div>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        ¿No tienes cuenta?{" "}
        <Link href="/signup" className="font-bold text-ink underline">
          Regístrate
        </Link>
      </p>
    </AuthShell>
  );
}
