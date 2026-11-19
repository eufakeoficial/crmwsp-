import { ExternalProviderError } from "@crmwsp/contracts";
import { z } from "zod";

/**
 * Gupshup Partner API business-profile client (Partner app token auth, NOT `apikey`).
 * Confirmed against https://partner-docs.gupshup.io/ :
 * - GET  /partner/app/{appId}/business/profile            (details)
 * - GET  /partner/app/{appId}/business/profile/about
 * - GET  /partner/app/{appId}/business/profile/photo
 * - PUT  /partner/app/{appId}/business/profile            (form-urlencoded: desc, addLine1, vertical, website1/2, profileEmail...)
 * - PUT  /partner/app/{appId}/business/profile/about      (form-urlencoded: about, max 512)
 * - PUT  /partner/app/{appId}/business/profile/photo      (multipart: image)
 * - POST /partner/app/{appId}/profile/displayName         (form-urlencoded: newDisplayName, 3 requests/day)
 * Redirects are refused, every call has a timeout, and the token is never logged or put in errors.
 */

export interface GupshupProfileClientOptions {
  fetch?: typeof globalThis.fetch;
  partnerBaseUrl?: string;
  timeoutMs?: number;
}

export interface GupshupPartnerCreds {
  appId: string;
  token: string;
}

export interface GupshupBusinessProfile {
  about: string | null;
  description: string | null;
  address: string | null;
  email: string | null;
  website1: string | null;
  website2: string | null;
  vertical: string | null;
  photoUrl: string | null;
}

export interface GupshupProfileUpdate {
  about?: string;
  description?: string;
  address?: string;
  email?: string;
  website1?: string;
  website2?: string;
  vertical?: string;
}

export class GupshupProfileError extends ExternalProviderError {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super("gupshup", message, status === undefined ? undefined : { details: { status } });
    if (status !== undefined) this.status = status;
  }
}

const str = z.union([z.string(), z.null()]).optional();
const detailsSchema = z.object({
  status: z.string().optional(),
  profile: z.object({ address: str, profileEmail: str, desc: str, vertical: str, website1: str, website2: str }).partial().optional(),
});
const aboutSchema = z.object({ status: z.string().optional(), about: z.object({ message: str }).partial().optional() });
const photoSchema = z.object({ status: z.string().optional(), message: str });
const statusSchema = z.object({ status: z.string().optional() });

type CallKind = "profile" | "photo" | "displayName";

/** Maps an HTTP status to a short, user-safe Spanish message. */
export function profileErrorMessage(status: number, kind: CallKind = "profile"): string {
  if (status === 401 || status === 403) return "Gupshup rechazó el Token de Partner. Revisa el ID de app y el token en la configuración del canal.";
  if (status === 404) return "Gupshup no encontró esa app. Revisa el ID de app.";
  if (status === 429) {
    return kind === "displayName"
      ? "Alcanzaste el límite de solicitudes de nombre por hoy (3 por día). Intenta mañana."
      : "Gupshup recibió demasiadas solicitudes. Intenta en unos minutos.";
  }
  if (status === 400) {
    if (kind === "photo") return "Gupshup rechazó la imagen. Usa un JPG o PNG cuadrado de hasta 5 MB.";
    if (kind === "displayName") return "Gupshup rechazó el nombre. Debe cumplir las reglas de WhatsApp (3 caracteres o más, sin símbolos raros, no todo en mayúsculas).";
    return "Gupshup rechazó los datos del perfil. Revisa los campos e intenta de nuevo.";
  }
  if (status >= 500) return "Gupshup no está disponible en este momento. Intenta de nuevo en unos minutos.";
  return "No se pudo completar la solicitud a Gupshup.";
}

export class GupshupProfileClient {
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GupshupProfileClientOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.baseUrl = (options.partnerBaseUrl ?? "https://partner.gupshup.io").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** Reads details + about + photo (three GETs; about/photo failures degrade to null). */
  async getProfile(creds: GupshupPartnerCreds): Promise<GupshupBusinessProfile> {
    const base = this.url(creds, "/business/profile");
    const detailsRes = await this.call(creds, base, { method: "GET" }, "profile");
    const details = detailsSchema.safeParse(await this.json(detailsRes));
    if (!details.success) throw new GupshupProfileError("Respuesta inesperada de Gupshup al leer el perfil.", detailsRes.status);
    const p = details.data.profile ?? {};
    const [about, photoUrl] = await Promise.all([
      this.optionalGet(creds, `${base}/about`, "profile", (j) => {
        const r = aboutSchema.safeParse(j);
        return r.success ? (r.data.about?.message ?? null) : null;
      }),
      this.optionalGet(creds, `${base}/photo`, "photo", (j) => {
        const r = photoSchema.safeParse(j);
        return r.success ? (r.data.message ?? null) : null;
      }),
    ]);
    return {
      about,
      description: p.desc ?? null,
      address: p.address ?? null,
      email: p.profileEmail ?? null,
      website1: p.website1 ?? null,
      website2: p.website2 ?? null,
      vertical: p.vertical ?? null,
      photoUrl,
    };
  }

  /** Updates only the provided fields (about goes through its own endpoint). */
  async updateProfile(creds: GupshupPartnerCreds, update: GupshupProfileUpdate): Promise<void> {
    const form = new URLSearchParams();
    if (update.description !== undefined) form.set("desc", update.description);
    if (update.address !== undefined) form.set("addLine1", update.address);
    if (update.email !== undefined) form.set("profileEmail", update.email);
    if (update.website1 !== undefined) form.set("website1", update.website1);
    if (update.website2 !== undefined) form.set("website2", update.website2);
    if (update.vertical !== undefined) form.set("vertical", update.vertical);
    const base = this.url(creds, "/business/profile");
    const formHeaders = { "content-type": "application/x-www-form-urlencoded" };
    if (form.toString() !== "") {
      const res = await this.call(creds, base, { method: "PUT", headers: formHeaders, body: form.toString() }, "profile");
      this.assertSuccess(await this.json(res), res.status);
    }
    if (update.about !== undefined) {
      const body = new URLSearchParams({ about: update.about }).toString();
      const res = await this.call(creds, `${base}/about`, { method: "PUT", headers: formHeaders, body }, "profile");
      this.assertSuccess(await this.json(res), res.status);
    }
  }

  async updatePhoto(creds: GupshupPartnerCreds, image: { data: Uint8Array; mime: string; filename: string }): Promise<void> {
    const form = new FormData();
    form.set("image", new Blob([image.data as unknown as ArrayBuffer], { type: image.mime }), image.filename);
    const res = await this.call(creds, this.url(creds, "/business/profile/photo"), { method: "PUT", body: form }, "photo");
    this.assertSuccess(await this.json(res), res.status);
  }

  /** Asks Meta to change the display name (needs Meta approval; Gupshup limits it to 3 requests/day). */
  async requestDisplayName(creds: GupshupPartnerCreds, displayName: string): Promise<void> {
    const body = new URLSearchParams({ newDisplayName: displayName }).toString();
    const res = await this.call(
      creds,
      this.url(creds, "/profile/displayName"),
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body },
      "displayName",
    );
    this.assertSuccess(await this.json(res), res.status);
  }

  private async optionalGet(creds: GupshupPartnerCreds, url: string, kind: CallKind, pick: (json: unknown) => string | null): Promise<string | null> {
    try {
      const res = await this.call(creds, url, { method: "GET" }, kind);
      return pick(await this.json(res));
    } catch {
      return null;
    }
  }

  private url(creds: GupshupPartnerCreds, path: string): string {
    return `${this.baseUrl}/partner/app/${encodeURIComponent(creds.appId)}${path}`;
  }

  private assertSuccess(json: unknown, status: number): void {
    const parsed = statusSchema.safeParse(json);
    if (!parsed.success || parsed.data.status !== "success") throw new GupshupProfileError("Gupshup no confirmó el cambio.", status);
  }

  private async json(res: Response): Promise<unknown> {
    try {
      return await res.json();
    } catch {
      throw new GupshupProfileError("Respuesta inválida de Gupshup.", res.status);
    }
  }

  private async call(creds: GupshupPartnerCreds, url: string, init: RequestInit, kind: CallKind): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), authorization: creds.token, accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // No `cause`: it may embed request details.
      throw new GupshupProfileError("No se pudo conectar con Gupshup. Intenta de nuevo.");
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      throw new GupshupProfileError(profileErrorMessage(res.status, kind), res.status);
    }
    return res;
  }
}
