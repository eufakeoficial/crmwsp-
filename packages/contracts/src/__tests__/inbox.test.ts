import { describe, expect, it } from "vitest";
import {
  OutsideServiceWindowError,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageRequestSchema,
  toErrorResponse,
  updateConversationRequestSchema,
} from "../index.js";

const id = "3f1c2b8e-9a4d-4c1e-8b2a-1d2e3f4a5b6c";

describe("listConversationsQuerySchema", () => {
  it("coerces limit and accepts me/unassigned/uuid", () => {
    expect(listConversationsQuerySchema.parse({ limit: "10" }).limit).toBe(10);
    expect(listConversationsQuerySchema.parse({}).limit).toBe(25);
    for (const assignedTo of ["me", "unassigned", id]) {
      expect(listConversationsQuerySchema.safeParse({ assignedTo }).success).toBe(true);
    }
    expect(listConversationsQuerySchema.safeParse({ assignedTo: "someone" }).success).toBe(false);
    expect(listConversationsQuerySchema.safeParse({ limit: "500" }).success).toBe(false);
    expect(listConversationsQuerySchema.safeParse({ status: "closed" }).success).toBe(false);
  });
});

describe("listMessagesQuerySchema", () => {
  it("defaults limit to 50", () => {
    expect(listMessagesQuerySchema.parse({}).limit).toBe(50);
  });
});

describe("sendMessageRequestSchema", () => {
  it("requires text and a uuid clientMessageId", () => {
    expect(sendMessageRequestSchema.safeParse({ text: "Hola", clientMessageId: id }).success).toBe(true);
    expect(sendMessageRequestSchema.safeParse({ text: "  ", clientMessageId: id }).success).toBe(false);
    expect(sendMessageRequestSchema.safeParse({ text: "Hola", clientMessageId: "x" }).success).toBe(false);
  });
});

describe("updateConversationRequestSchema", () => {
  it("accepts partial updates and null assignee", () => {
    expect(updateConversationRequestSchema.safeParse({ assignedUserId: null, lockVersion: 0 }).success).toBe(true);
    expect(updateConversationRequestSchema.safeParse({ status: "resolved" }).success).toBe(true);
  });
  it("rejects an empty update", () => {
    expect(updateConversationRequestSchema.safeParse({ lockVersion: 1 }).success).toBe(false);
  });
});

describe("OutsideServiceWindowError", () => {
  it("maps to 422 OUTSIDE_SERVICE_WINDOW", () => {
    const err = new OutsideServiceWindowError();
    expect(err.httpStatus).toBe(422);
    expect(toErrorResponse(err).code).toBe("OUTSIDE_SERVICE_WINDOW");
  });
});
