"use client";

import type { InvitationPreview, MeResponse } from "@crmwsp/contracts";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { AuthShell } from "@/components/AuthShell";
import { ROLE_LABELS } from "@/components/app/roles";
import { Alert, Button, Input, Label, PasswordInput } from "@/components/ui";
import { api, setActiveTenantId } from "@/lib/api";
import { errorMessage } from "@/lib/messages";
import { acceptErrorMessage, teamApi } from "@/lib/team-api";
import { storeTenantId } from "@/lib/tenant";

type State =
  | { status: "loading" }
  | { status: "invalid"; message: string }
  | { status: "ready"; invite: InvitationPreview; me: MeResponse | null };

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = String(params.token ?? "");
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([teamApi.preview(token), api.me().catch(() => null)])
      .then(([invite, me]) => !cancelled && setState({ status: "ready", invite, me }))
      .catch((err: unknown) => !cancelled && setState({ status: "invalid", message: acceptErrorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function finish(run: () => Promise<{ tenantId: string }>) {
    setBusy(true);
    setError(undefined);
    try {
      const { tenantId } = await run();
      setActiveTenantId(tenantId);
      storeTenantId(tenantId);
      router.replace("/app/inbox");
    } catch (err) {
      setError(acceptErrorMessage(err));
      setBusy(false);
    }
  }

  function onSignup(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    void finish(() => teamApi.accept(token, { name: String(form.get("name")), password: String(form.get("password")) }));
  }

  async function onLogin(e: FormEvent<HTMLFormElement>, email: string) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setBusy(true);
    setError(undefined);
    try {
      await api.login({ email, password });
    } catch (err) {
      setError(errorMessage(err, "login"));
      setBusy(false);
      return;
    }
    await finish(() => teamApi.accept(token));
  }

  if (state.status === "loading") {
    return (
      <AuthShell title="Invitación">
        <p className="text-sm text-muted" aria-busy="true">Cargando…</p>
      </AuthShell>
    );
  }
  if (state.status === "invalid") {
    return (
      <AuthShell title="Invitación no válida">
        <Alert>{state.message}</Alert>
        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="font-bold text-ink underline">
            Ir a iniciar sesión
          </Link>
        </p>
      </AuthShell>
    );
  }

  const { invite, me } = state;
  const signedInAsInvited = me && me.user.email.toLowerCase() === invite.email.toLowerCase();
  return (
    <AuthShell title={`Únete a ${invite.tenantName}`} subtitle={`Te invitaron como ${ROLE_LABELS[invite.role]} con ${invite.email}.`}>
      {signedInAsInvited ? (
        <Button variant="accent" size="lg" className="w-full" disabled={busy} onClick={() => void finish(() => teamApi.accept(token))}>
          {busy ? "Aceptando…" : "Aceptar invitación"}
        </Button>
      ) : me ? (
        <Alert>{`Has iniciado sesión como ${me.user.email}. Esta invitación es para ${invite.email}: cierra sesión e inicia con el correo invitado.`}</Alert>
      ) : invite.hasAccount ? (
        <form method="post" onSubmit={(e) => void onLogin(e, invite.email)} className="space-y-4">
          <p className="m-0 text-sm text-muted">Ya tienes cuenta: inicia sesión para aceptar.</p>
          <div className="space-y-1">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" type="email" value={invite.email} readOnly />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Contraseña</Label>
            <PasswordInput id="password" name="password" autoComplete="current-password" required />
          </div>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
            {busy ? "Entrando…" : "Entrar y aceptar"}
          </Button>
        </form>
      ) : (
        <form method="post" onSubmit={onSignup} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="email">Correo electrónico</Label>
            <Input id="email" type="email" value={invite.email} readOnly />
          </div>
          <div className="space-y-1">
            <Label htmlFor="name">Tu nombre</Label>
            <Input id="name" name="name" autoComplete="name" required maxLength={200} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="password">Contraseña (mínimo 10 caracteres)</Label>
            <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} required />
          </div>
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
            {busy ? "Creando cuenta…" : "Crear cuenta y aceptar"}
          </Button>
        </form>
      )}
      <div className="mt-4">
        <Alert>{error}</Alert>
      </div>
    </AuthShell>
  );
}
