import { applyBotTemplateResponseSchema, botTemplateListSchema, type ApplyBotTemplateResponse, type BotTemplate } from "@crmwsp/contracts";
import { request } from "./api";

export const botTemplatesApi = {
  list: async (): Promise<BotTemplate[]> => (await request("/bot-templates", { schema: botTemplateListSchema })).items,
  apply: (id: string, overwrite: boolean): Promise<ApplyBotTemplateResponse> =>
    request(`/bot-templates/${encodeURIComponent(id)}/apply`, { method: "POST", body: overwrite ? { overwrite: true } : {}, schema: applyBotTemplateResponseSchema }),
};
