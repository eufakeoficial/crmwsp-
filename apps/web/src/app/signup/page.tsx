"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { tenantSlugSchema } from "@crmwsp/contracts";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label } from "@/components/ui";
import { api } from "@/lib/api";
import { routeAfterAuth } from "@/lib/after-auth";
import { errorMessage } from "@/lib/messages";
import { slugify } from "@/lib/slug";

export default function SignupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const name = String(form.get("name")).trim();
    const email = String(form.get("email")).trim();
    const password = String(form.get("password"));

    const errors: Record<string, string> = {};
    if (!name) errors["name"] = "Escribe tu nombre.";
    if (!/^\S+@\S+\.\S+$/.test(email)) errors["email"] = "Escribe un correo válido.";
    if (password.length < 10) errors["password"] = "La contraseña debe tener al menos 10 caracteres.";
    if (!tenantName.trim()) errors["tenantName"] = "Escribe el nombre de tu empresa.";
    if (!tenantSlugSchema.safeParse(slug).success)
      errors["slug"] = "Usa de 3 a 63 caracteres: minúsculas, números y guiones intermedios.";
    setFieldErrors(errors);
    setError(undefined);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      const me = await api.signup({ email, name, password, tenantName: tenantName.trim(), tenantSlug: slug });
      router.replace(routeAfterAuth(me));
    } catch (err) {
      setError(errorMessage(err, "signup"));
      setBusy(false);
    }
  }

  const invalid = (k: string) => (fieldErrors[k] ? true : undefined);
  const hint = (k: string) => (fieldErrors[k] ? <p id={`${k}-error`} className="text-sm font-semibold text-danger">{fieldErrors[k]}</p> : null);

  return (
    <AuthShell title="Crear cuenta" subtitle="Registra tu empresa y empieza en minutos.">
      <form method="post" onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="name">Tu nombre</Label>
          <Input id="name" name="name" autoComplete="name" required aria-invalid={invalid("name")} aria-describedby={fieldErrors["name"] ? "name-error" : undefined} />
          <div aria-live="polite">{hint("name")}</div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="email">Correo electrónico</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={invalid("email")} aria-describedby={fieldErrors["email"] ? "email-error" : undefined} />
          <div aria-live="polite">{hint("email")}</div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="password">Contraseña</Label>
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required aria-invalid={invalid("password")} aria-describedby={fieldErrors["password"] ? "password-error" : "password-help"} />
          <p id="password-help" className="text-xs text-muted">Mínimo 10 caracteres.</p>
          <div aria-live="polite">{hint("password")}</div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tenantName">Nombre de la empresa</Label>
          <Input
            id="tenantName"
            name="tenantName"
            autoComplete="organization"
            required
            value={tenantName}
            aria-invalid={invalid("tenantName")}
            aria-describedby={fieldErrors["tenantName"] ? "tenantName-error" : undefined}
            onChange={(e) => {
              setTenantName(e.target.value);
              if (!slugTouched) setSlug(slugify(e.target.value));
            }}
          />
          <div aria-live="polite">{hint("tenantName")}</div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="slug">Identificador de la empresa</Label>
          <Input
            id="slug"
            name="slug"
            autoComplete="off"
            required
            value={slug}
            aria-invalid={invalid("slug")}
            aria-describedby={fieldErrors["slug"] ? "slug-error" : "slug-help"}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value);
            }}
          />
          <p id="slug-help" className="text-xs text-muted">Se genera a partir del nombre; puedes editarlo.</p>
          <div aria-live="polite">{hint("slug")}</div>
        </div>
        <Alert>{error}</Alert>
        <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
          {busy ? "Creando cuenta…" : "Crear cuenta"}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">
        ¿Ya tienes cuenta?{" "}
        <Link href="/login" className="font-bold text-ink underline">
          Inicia sesión
        </Link>
      </p>
    </AuthShell>
  );
}
