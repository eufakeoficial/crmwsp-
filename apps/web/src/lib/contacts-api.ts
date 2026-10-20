import {
  contactBookDetailSchema,
  contactBookItemSchema,
  contactBookListSchema,
  type ListContactBookQuery,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Contacts directory (GET/PATCH/PUT /contact-book). */
export const contactBookApi = {
  list: (q: Partial<Pick<ListContactBookQuery, "q" | "cursor" | "limit">> = {}) =>
    request("/contact-book", { query: { q: q.q || undefined, cursor: q.cursor, limit: q.limit }, schema: contactBookListSchema }),
  get: (id: string) => request(`/contact-book/${id}`, { schema: contactBookDetailSchema }),
  setTags: (id: string, tags: string[]) =>
    request(`/contact-book/${id}/tags`, { method: "PATCH", body: { tags }, schema: contactBookItemSchema }),
  setMarketingConsent: (id: string, granted: boolean) =>
    request(`/contact-book/${id}/marketing-consent`, { method: "PUT", body: { granted }, schema: contactBookItemSchema }),
};
