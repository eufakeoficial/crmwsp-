import { messageTemplateListSchema, messageTemplateSchema, syncTemplatesResponseSchema, type SubmitTemplateRequest } from "@crmwsp/contracts";
import { ApiError, request } from "./api";
import { channelErrorMessage } from "./messages";

export const waTemplatesApi = {
  list: (channelId: string) => request(`/channels/${channelId}/templates`, { schema: messageTemplateListSchema }),
  submit: (channelId: string, body: SubmitTemplateRequest) =>
    request(`/channels/${channelId}/templates`, { method: "POST", body, schema: messageTemplateSchema }),
  sync: (channelId: string) => request(`/channels/${channelId}/templates/sync`, { method: "POST", schema: syncTemplatesResponseSchema }),
};

/** Spanish message for template submit/sync errors; surfaces the API's own reason when it is a 400/409/502. */
export function templateErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 409) return "Ya existe una plantilla con ese nombre e idioma en este canal.";
    if (err.status === 400 && /partner credentials/i.test(err.message)) return "Este canal no tiene las credenciales de plantillas configuradas.";
    if (err.status === 400 && /disabled/i.test(err.message)) return "El canal está desactivado.";
    if (err.status === 502 || err.status === 504 || err.code === "EXTERNAL_PROVIDER_ERROR") {
      return `El proveedor de WhatsApp rechazó o no pudo procesar la solicitud${err.message ? `: ${err.message}` : "."}`;
    }
  }
  return channelErrorMessage(err);
}
