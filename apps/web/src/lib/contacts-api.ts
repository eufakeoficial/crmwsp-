import {
  contactBookDetailSchema,
  contactBookItemSchema,
  contactBookListSchema,
  contactBookSearchResultSchema,
  contactBulkResultSchema,
  contactTagCountsSchema,
  importContactsResultSchema,
  type ContactBulkRequest,
  type ListContactBookQuery,
  type SearchContactBookRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Contacts directory (GET/PATCH/PUT /contact-book). */
export const contactBookApi = {
  list: (q: Partial<Pick<ListContactBookQuery, "q" | "cursor" | "limit">> = {}) =>
    request("/contact-book", { query: { q: q.q || undefined, cursor: q.cursor, limit: q.limit }, schema: contactBookListSchema }),
  search: (body: SearchContactBookRequest) =>
    request("/contact-book/search", { method: "POST", body: { ...body, q: body.q || undefined }, schema: contactBookSearchResultSchema }),
  tags: () => request("/contact-book/tags", { schema: contactTagCountsSchema }),
  bulk: (body: ContactBulkRequest) => request("/contact-book/bulk", { method: "POST", body, schema: contactBulkResultSchema }),
  importCsv: (csv: string) => request("/contact-book/import", { method: "POST", body: { csv }, schema: importContactsResultSchema }),
  get: (id: string) => request(`/contact-book/${id}`, { schema: contactBookDetailSchema }),
  setTags: (id: string, tags: string[]) =>
    request(`/contact-book/${id}/tags`, { method: "PATCH", body: { tags }, schema: contactBookItemSchema }),
  setMarketingConsent: (id: string, granted: boolean) =>
    request(`/contact-book/${id}/marketing-consent`, { method: "PUT", body: { granted }, schema: contactBookItemSchema }),
};
