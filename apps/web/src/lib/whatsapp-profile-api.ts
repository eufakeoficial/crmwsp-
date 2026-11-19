import {
  whatsappProfileActionResponseSchema,
  whatsappProfileSchema,
  type RequestDisplayNameRequest,
  type UpdateWhatsappProfileRequest,
} from "@crmwsp/contracts";
import { ApiError, request } from "./api";
import { errorMessage } from "./messages";

export const whatsappProfileApi = {
  get: (channelId: string) => request(`/whatsapp-profile/${channelId}`, { schema: whatsappProfileSchema }),
  update: (channelId: string, body: UpdateWhatsappProfileRequest) =>
    request(`/whatsapp-profile/${channelId}`, { method: "PUT", body, schema: whatsappProfileActionResponseSchema }),
  uploadPhoto: (channelId: string, file: File) => {
    const form = new FormData();
    form.set("file", file);
    return request(`/whatsapp-profile/${channelId}/photo`, { method: "POST", body: form, schema: whatsappProfileActionResponseSchema });
  },
  requestDisplayName: (channelId: string, body: RequestDisplayNameRequest) =>
    request(`/whatsapp-profile/${channelId}/display-name`, { method: "POST", body, schema: whatsappProfileActionResponseSchema }),
};

/** Client-side photo check, mirrors the API: JPG or PNG up to 5 MB. Returns a Spanish message or null. */
export function photoProblem(file: { type: string; size: number }): string | null {
  if (file.type !== "image/jpeg" && file.type !== "image/png") return "La foto debe ser JPG o PNG.";
  if (file.size > 5 * 1024 * 1024) return "La foto no puede pesar más de 5 MB.";
  if (file.size === 0) return "El archivo está vacío.";
  return null;
}

/**
 * Spanish text for profile errors. The API's own Spanish messages (missing credentials, Gupshup errors)
 * are shown as they are; generic validation errors fall back to a short hint.
 */
export function profileErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.code !== "VALIDATION_ERROR" && err.code !== "EXTERNAL_PROVIDER_ERROR") return errorMessage(err);
  if (err instanceof ApiError && err.message && err.message !== "Validation failed" && /[áéíóúñ¿]|Gupshup|Este canal|Agrégalos/.test(err.message)) return err.message;
  if (err instanceof ApiError && err.code === "VALIDATION_ERROR") return "Revisa los datos: algún campo no es válido.";
  if (err instanceof ApiError && err.code === "EXTERNAL_PROVIDER_ERROR") return "Gupshup no pudo procesar la solicitud. Intenta de nuevo en unos minutos.";
  return errorMessage(err);
}

/** True when the API says the channel lacks the Partner "ID de app" / "Token de Partner". */
export function isMissingPartnerCredentials(err: unknown): boolean {
  return err instanceof ApiError && err.status === 400 && /Token de Partner/.test(err.message);
}
