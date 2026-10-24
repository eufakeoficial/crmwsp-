"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { tenantSlugSchema, type BusinessCategoryOption } from "@crmwsp/contracts";
import { AuthShell } from "@/components/AuthShell";
import { Alert, Button, Input, Label, PasswordInput } from "@/components/ui";
import { api } from "@/lib/api";
import { routeAfterAuth } from "@/lib/after-auth";
import { errorMessage } from "@/lib/messages";
import { slugify } from "@/lib/slug";
import { categoriesApi } from "@/lib/policies-api";

export default function SignupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [categories, setCategories] = useState<BusinessCategoryOption[]>([]);
  const [category, setCategory] = useState("");
  const [categoryDetail, setCategoryDetail] = useState("");
  const chosen = categories.find((c) => c.key === category);

  useEffect(() => {
    // Best effort: without the catalog the signup still works and the panel asks later.
    categoriesApi.list().then((r) => setCategories(r.items), () => setCategories([]));
  }, []);

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
    if (categories.length > 0 && !category) errors["category"] = "Elige el rubro de tu negocio.";
    if (chosen?.action === "block") errors["category"] = "Este rubro no está permitido por las políticas de WhatsApp Business.";
    setFieldErrors(errors);
    setError(undefined);
    if (Object.keys(errors).length > 0) return;

    setBusy(true);
    try {
      // Referral link `/signup?ref=CODE` (ADR 0017); ignored when malformed.
      const ref = new URLSearchParams(window.location.search).get("ref")?.trim() ?? "";
      const referralCode = /^[A-Za-z0-9]{1,32}$/.test(ref) ? ref : undefined;
      const me = await api.signup({ email, name, password, tenantName: tenantName.trim(), tenantSlug: slug, referralCode,
        ...(category ? { businessCategory: category, ...(categoryDetail.trim() ? { businessCategoryDetail: categoryDetail.trim() } : {}) } : {}),
      });
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
          <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} required aria-invalid={invalid("password")} aria-describedby={fieldErrors["password"] ? "password-error" : "password-help"} />
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
        {categories.length > 0 ? (
          <div className="space-y-1">
            <Label htmlFor="category">Rubro del negocio</Label>
            <select
              id="category"
              name="category"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-invalid={invalid("category")}
              aria-describedby={fieldErrors["category"] ? "category-error" : "category-help"}
              className="h-11 w-full rounded-xl border-[1.5px] border-ink bg-white px-3 text-sm text-ink"
            >
              <option value="">Elige una opción…</option>
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            {chosen?.action === "block" ? (
              <p id="category-help" className="text-xs font-semibold text-danger">
                Este rubro no está permitido por las políticas de WhatsApp Business, así que no podemos crear la cuenta.
              </p>
            ) : chosen?.action === "review" ? (
              <p id="category-help" className="text-xs text-muted">
                Este rubro requiere una revisión manual: podrás usar el panel, pero no conectar WhatsApp hasta que lo aprobemos.
                {chosen.guidance ? ` ${chosen.guidance}` : ""}
              </p>
            ) : chosen?.guidance ? (
              <p id="category-help" className="text-xs text-muted">{chosen.guidance}</p>
            ) : (
              <p id="category-help" className="text-xs text-muted">Lo usamos para cumplir las políticas de WhatsApp Business.</p>
            )}
            {chosen && (chosen.action === "review" || chosen.key === "otro") ? (
              <Input
                id="categoryDetail"
                name="categoryDetail"
                maxLength={200}
                placeholder="Cuéntanos brevemente qué vendes"
                value={categoryDetail}
                onChange={(e) => setCategoryDetail(e.target.value)}
              />
            ) : null}
            <div aria-live="polite">{hint("category")}</div>
          </div>
        ) : null}
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
