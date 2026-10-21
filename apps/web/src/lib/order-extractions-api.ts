import { type OrderExtractionStatus, orderExtractionListSchema, orderExtractionSchema } from "@crmwsp/contracts";
import { request } from "./api";

/** Orders detected by the AI in voice notes, photos and PDFs (F4). */
export const orderExtractionsApi = {
  list: (conversationId: string, status?: OrderExtractionStatus) =>
    request("/order-extractions", { query: { conversationId, ...(status ? { status } : {}) }, schema: orderExtractionListSchema }),
  get: (id: string) => request(`/order-extractions/${id}`, { schema: orderExtractionSchema }),
  /** Pick the catalog product/variant of a line and/or its quantity (catalog unit); re-prices the draft quote. */
  updateLine: (
    id: string,
    index: number,
    input: { lockVersion: number; productId?: string; variantId?: string | null; quantity?: number; remove?: boolean },
  ) => request(`/order-extractions/${id}/lines/${index}`, { method: "PATCH", body: input, schema: orderExtractionSchema }),
  discard: (id: string, lockVersion: number) =>
    request(`/order-extractions/${id}/discard`, { method: "POST", body: { lockVersion }, schema: orderExtractionSchema }),
};
