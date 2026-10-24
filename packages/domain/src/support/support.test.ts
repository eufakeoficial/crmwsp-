import { describe, expect, it } from "vitest";
import {
  canTenantClose,
  canViewSupportTicket,
  renderCannedResponse,
  statusAfterAdminReply,
  statusAfterTenantReply,
} from "./index.js";

describe("statusAfterTenantReply", () => {
  it("reopens tickets waiting for the customer or resolved", () => {
    expect(statusAfterTenantReply("waiting_customer")).toBe("open");
    expect(statusAfterTenantReply("resolved")).toBe("open");
  });
  it("keeps open and in-progress tickets as they are", () => {
    expect(statusAfterTenantReply("open")).toBe("open");
    expect(statusAfterTenantReply("in_progress")).toBe("in_progress");
  });
});

describe("statusAfterAdminReply", () => {
  it("moves active tickets to waiting_customer on a public reply", () => {
    expect(statusAfterAdminReply("open", false)).toBe("waiting_customer");
    expect(statusAfterAdminReply("in_progress", false)).toBe("waiting_customer");
    expect(statusAfterAdminReply("waiting_customer", false)).toBe("waiting_customer");
  });
  it("never changes the status for internal notes or resolved tickets", () => {
    expect(statusAfterAdminReply("open", true)).toBe("open");
    expect(statusAfterAdminReply("in_progress", true)).toBe("in_progress");
    expect(statusAfterAdminReply("resolved", false)).toBe("resolved");
  });
});

describe("canTenantClose", () => {
  it("allows closing anything not resolved", () => {
    expect(canTenantClose("open")).toBe(true);
    expect(canTenantClose("in_progress")).toBe(true);
    expect(canTenantClose("waiting_customer")).toBe(true);
    expect(canTenantClose("resolved")).toBe(false);
  });
});

describe("canViewSupportTicket", () => {
  const creator = "11111111-1111-4111-8111-111111111111";
  const other = "22222222-2222-4222-8222-222222222222";
  it("lets owners and admins see every ticket of the tenant", () => {
    expect(canViewSupportTicket({ userId: other, role: "owner" }, creator)).toBe(true);
    expect(canViewSupportTicket({ userId: other, role: "admin" }, creator)).toBe(true);
  });
  it("lets agents and viewers see only their own tickets", () => {
    expect(canViewSupportTicket({ userId: creator, role: "agent" }, creator)).toBe(true);
    expect(canViewSupportTicket({ userId: other, role: "agent" }, creator)).toBe(false);
    expect(canViewSupportTicket({ userId: other, role: "viewer" }, creator)).toBe(false);
  });
  it("hides tickets whose creator was deleted from non-admins", () => {
    expect(canViewSupportTicket({ userId: other, role: "agent" }, null)).toBe(false);
    expect(canViewSupportTicket({ userId: other, role: "owner" }, null)).toBe(true);
  });
});

describe("renderCannedResponse", () => {
  it("replaces known variables, tolerating spaces inside the braces", () => {
    expect(renderCannedResponse("Hola {{nombre}}, gracias por escribir desde {{ negocio }}.", { nombre: "Ana", negocio: "Dental Sur" })).toBe(
      "Hola Ana, gracias por escribir desde Dental Sur.",
    );
  });
  it("uses the ticket number and subject", () => {
    expect(renderCannedResponse("Ticket #{{ticket}}: {{asunto}}", { ticket: "42", asunto: "No llegan mensajes" })).toBe(
      "Ticket #42: No llegan mensajes",
    );
  });
  it("leaves unknown variables untouched and blanks known ones without a value", () => {
    expect(renderCannedResponse("{{otro}} y {{nombre}}!", {})).toBe("{{otro}} y !");
  });
  it("does not re-expand values that contain braces", () => {
    expect(renderCannedResponse("{{nombre}}", { nombre: "{{negocio}}", negocio: "X" })).toBe("{{negocio}}");
  });
});
