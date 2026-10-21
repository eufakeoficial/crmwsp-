import {
  contactSegmentListSchema,
  contactSegmentSchema,
  type CreateContactSegmentRequest,
  type UpdateContactSegmentRequest,
} from "@crmwsp/contracts";
import { request } from "./api";

/** Saved contact filters (/segments). Counts are live. */
export const segmentsApi = {
  list: () => request("/segments", { schema: contactSegmentListSchema }),
  create: (body: CreateContactSegmentRequest) => request("/segments", { method: "POST", body, schema: contactSegmentSchema }),
  update: (id: string, body: UpdateContactSegmentRequest) => request(`/segments/${id}`, { method: "PATCH", body, schema: contactSegmentSchema }),
  remove: (id: string) => request(`/segments/${id}`, { method: "DELETE" }),
};
