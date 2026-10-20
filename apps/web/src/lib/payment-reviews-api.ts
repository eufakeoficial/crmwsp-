import { type PaymentReviewStatus, paymentReviewListSchema, paymentReviewSchema } from "@crmwsp/contracts";
import { request } from "./api";

export const paymentReviewsApi = {
  list: (status: PaymentReviewStatus = "pending") =>
    request("/payment-reviews", { query: { status }, schema: paymentReviewListSchema }),
  get: (id: string) => request(`/payment-reviews/${id}`, { schema: paymentReviewSchema }),
  /** Owner/admin: runs the audited manual mark-paid with the reviewer recorded. */
  approve: (id: string, note?: string) =>
    request(`/payment-reviews/${id}/approve`, { method: "POST", body: note ? { note } : {}, schema: paymentReviewSchema }),
  reject: (id: string, reason: string) =>
    request(`/payment-reviews/${id}/reject`, { method: "POST", body: { reason }, schema: paymentReviewSchema }),
};
