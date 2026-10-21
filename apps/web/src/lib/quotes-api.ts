import {
  type CreateQuoteRequest,
  type PatchQuoteRequest,
  type QuoteStatus,
  orderSchema,
  paymentLinkSchema,
  productSearchListSchema,
  quoteAcceptLinkSchema,
  quoteListSchema,
  quoteSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export const quotesApi = {
  list: (status?: QuoteStatus) => request("/quotes", { query: { status }, schema: quoteListSchema }),
  get: (id: string) => request(`/quotes/${id}`, { schema: quoteSchema }),
  create: (input: CreateQuoteRequest) => request("/quotes", { method: "POST", body: input, schema: quoteSchema }),
  patch: (id: string, input: PatchQuoteRequest) => request(`/quotes/${id}`, { method: "PATCH", body: input, schema: quoteSchema }),
  /** draft -> approved, or pending_approval above the threshold / with discounts. */
  submit: (id: string) => request(`/quotes/${id}/submit`, { method: "POST", schema: quoteSchema }),
  approve: (id: string) => request(`/quotes/${id}/approve`, { method: "POST", schema: quoteSchema }),
  reject: (id: string) => request(`/quotes/${id}/reject`, { method: "POST", schema: quoteSchema }),
  /** approved -> sent; queues the WhatsApp message carrying the public acceptance link. */
  send: (id: string) => request(`/quotes/${id}/send`, { method: "POST", schema: quoteSchema }),
  /** Issues a new public link (the one already sent stops working). */
  acceptLink: (id: string) => request(`/quotes/${id}/accept-link`, { method: "POST", schema: quoteAcceptLinkSchema }),
  /** accepted -> draft order (idempotent). */
  convertToOrder: (id: string) => request(`/quotes/${id}/convert-to-order`, { method: "POST", body: {}, schema: orderSchema }),
};

export const catalogSearchApi = {
  search: (q: string, limit = 20) => request("/products/search", { query: { q, limit }, schema: productSearchListSchema }),
};

export const orderPaymentApi = {
  /** The order is only ever marked paid by the verified provider webhook. */
  createLink: (orderId: string) => request(`/orders/${orderId}/payment-link`, { method: "POST", body: {}, schema: paymentLinkSchema }),
};
