import { describe, expect, it } from "vitest";
import {
  createSupportTicketRequestSchema,
  platformSupportListQuerySchema,
  platformSupportReplyRequestSchema,
  platformSupportUpdateRequestSchema,
  supportEventSchema,
} from "../support.js";

describe("support contracts", () => {
  it("defaults priority to normal and trims the subject", () => {
    const v = createSupportTicketRequestSchema.parse({ subject: "  No llegan mensajes ", category: "whatsapp", message: "Desde ayer" });
    expect(v).toEqual({ subject: "No llegan mensajes", category: "whatsapp", priority: "normal", message: "Desde ayer" });
  });
  it("rejects unknown categories and empty messages", () => {
    expect(createSupportTicketRequestSchema.safeParse({ subject: "Hola mundo", category: "x", message: "a" }).success).toBe(false);
    expect(createSupportTicketRequestSchema.safeParse({ subject: "Hola mundo", category: "ai", message: "   " }).success).toBe(false);
  });
  it("defaults admin replies to public", () => {
    expect(platformSupportReplyRequestSchema.parse({ body: "Listo" }).internal).toBe(false);
  });
  it("requires at least one field on update", () => {
    expect(platformSupportUpdateRequestSchema.safeParse({}).success).toBe(false);
    expect(platformSupportUpdateRequestSchema.safeParse({ assignToMe: true }).success).toBe(true);
  });
  it("treats empty query filters as absent", () => {
    expect(platformSupportListQuerySchema.parse({ status: "", priority: "high" })).toEqual({ priority: "high" });
  });
  it("accepts the realtime event with ids only", () => {
    expect(supportEventSchema.safeParse({ type: "support.ticket_updated", ticketId: "7d1c2b8e-9a4d-4c1e-8b2a-1d2e3f4a5b6c" }).success).toBe(true);
    expect(supportEventSchema.safeParse({ type: "support.ticket_updated" }).success).toBe(false);
  });
});
