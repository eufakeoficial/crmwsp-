"use client";

import {
  WHATSAPP_PROFILE_ABOUT_MAX,
  updateWhatsappProfileRequestSchema,
  type UpdateWhatsappProfileRequest,
  type WhatsappProfile,
} from "@crmwsp/contracts";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Alert, Button, Card, Input, Label, Textarea } from "@/components/ui";
import { isMissingPartnerCredentials, profileErrorMessage, whatsappProfileApi } from "@/lib/whatsapp-profile-api";
import { MissingCredentialsCard } from "./MissingCredentialsCard";
import { PhotoUpload } from "./PhotoUpload";
import { VERTICAL_LABELS, buildUpdate, toForm, type ProfileForm } from "./profile-form";

export function ProfileEditor({ channelId, onSaved }: { channelId: string; onSaved: (message: string) => void }) {
  const [profile, setProfile] = useState<WhatsappProfile | null>(null);
  const [form, setForm] = useState<ProfileForm | null>(null);
  const [error, setError] = useState<string>();
  const [missing, setMissing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await whatsappProfileApi.get(channelId);
      setProfile(p);
      setForm(toForm(p));
      setError(undefined);
    } catch (err) {
      if (isMissingPartnerCredentials(err)) setMissing(true);
      else setError(profileErrorMessage(err));
    }
  }, [channelId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!profile || !form) return;
    const update = buildUpdate(profile, form);
    if (Object.keys(update).length === 0) {
      setError("No hay cambios para guardar.");
      return;
    }
    const parsed = updateWhatsappProfileRequestSchema.safeParse(update);
    if (!parsed.success) {
      setError(`Revisa los datos: ${parsed.error.issues[0]?.path.join(".") === "email" ? "el correo no es válido." : parsed.error.issues[0]?.path.join(".").startsWith("website") ? "los sitios web deben empezar con http:// o https://." : "algún campo no es válido."}`);
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await whatsappProfileApi.update(channelId, parsed.data as UpdateWhatsappProfileRequest);
      onSaved("Perfil guardado");
      await load();
    } catch (err) {
      setError(profileErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (missing) return <MissingCredentialsCard phone="este número" />;
  if (!form) return error ? <Alert>{error}</Alert> : <p className="text-muted" aria-busy="true">Cargando perfil…</p>;

  const set = (k: keyof ProfileForm) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <Card className="flex flex-col gap-3">
        <h2 className="m-0 text-lg font-bold">Foto de perfil</h2>
        <PhotoUpload channelId={channelId} currentUrl={profile?.photoUrl ?? null} onUploaded={() => { onSaved("Foto actualizada"); void load(); }} />
      </Card>
      <Card>
        <form className="flex flex-col gap-4" onSubmit={(e) => void save(e)} noValidate>
          <h2 className="m-0 text-lg font-bold">Datos del negocio</h2>
          <div>
            <Label htmlFor="wa-about">Info (frase corta bajo tu nombre)</Label>
            <Textarea id="wa-about" rows={2} maxLength={WHATSAPP_PROFILE_ABOUT_MAX} value={form.about} onChange={set("about")} />
          </div>
          <div>
            <Label htmlFor="wa-desc">Descripción</Label>
            <Textarea id="wa-desc" rows={3} maxLength={512} value={form.description} onChange={set("description")} />
          </div>
          <div>
            <Label htmlFor="wa-address">Dirección</Label>
            <Input id="wa-address" maxLength={256} value={form.address} onChange={set("address")} />
          </div>
          <div>
            <Label htmlFor="wa-email">Correo de contacto</Label>
            <Input id="wa-email" type="email" maxLength={128} value={form.email} onChange={set("email")} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="wa-web1">Sitio web 1</Label>
              <Input id="wa-web1" inputMode="url" placeholder="https://" maxLength={256} value={form.website1} onChange={set("website1")} />
            </div>
            <div>
              <Label htmlFor="wa-web2">Sitio web 2</Label>
              <Input id="wa-web2" inputMode="url" placeholder="https://" maxLength={256} value={form.website2} onChange={set("website2")} />
            </div>
          </div>
          <div>
            <Label htmlFor="wa-vertical">Categoría</Label>
            <select id="wa-vertical" value={form.vertical} onChange={set("vertical")} className="block h-12 w-full rounded-[14px] border-[1.5px] border-ink bg-white px-3.5 text-[16px] text-ink">
              <option value="">Sin cambios</option>
              {Object.entries(VERTICAL_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <Alert>{error}</Alert>
          <div>
            <Button type="submit" variant="accent" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
