import {
  type CreateProductRequest,
  type ListOrdersQuery,
  type ListProductsQuery,
  type PatchProductRequest,
  type UpsertVariantsRequest,
  orderListSchema,
  orderSchema,
  productListSchema,
  productSchema,
} from "@crmwsp/contracts";
import { request } from "./api";

export const ordersApi = {
  list: (q: Partial<Pick<ListOrdersQuery, "status" | "cursor" | "limit">> = {}) =>
    request("/orders", { query: { status: q.status, cursor: q.cursor, limit: q.limit }, schema: orderListSchema }),
  get: (id: string) => request(`/orders/${id}`, { schema: orderSchema }),
  confirm: (id: string) => request(`/orders/${id}/confirm`, { method: "POST", schema: orderSchema }),
  cancel: (id: string) => request(`/orders/${id}/cancel`, { method: "POST", schema: orderSchema }),
  fulfill: (id: string) => request(`/orders/${id}/fulfill`, { method: "POST", schema: orderSchema }),
  ship: (id: string) => request(`/orders/${id}/ship`, { method: "POST", schema: orderSchema }),
  deliver: (id: string) => request(`/orders/${id}/deliver`, { method: "POST", schema: orderSchema }),
  /** Manual payment: owner/admin only, reason mandatory (3..500 chars). */
  markPaid: (id: string, reason: string) =>
    request(`/orders/${id}/mark-paid`, { method: "POST", body: { reason }, schema: orderSchema }),
};

export const productsApi = {
  list: (q: Partial<Pick<ListProductsQuery, "q" | "status" | "cursor" | "limit">> = {}) =>
    request("/products", { query: { q: q.q, status: q.status, cursor: q.cursor, limit: q.limit }, schema: productListSchema }),
  create: (input: CreateProductRequest) => request("/products", { method: "POST", body: input, schema: productSchema }),
  patch: (id: string, input: PatchProductRequest) =>
    request(`/products/${id}`, { method: "PATCH", body: input, schema: productSchema }),
  putVariants: (id: string, input: UpsertVariantsRequest) =>
    request(`/products/${id}/variants`, { method: "PUT", body: input, schema: productSchema }),
};
