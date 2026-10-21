import type { WhatsAppConnection, WhatsAppProvider } from "@crmwsp/whatsapp";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { dispatchOutbound, type OutboundTemplate } from "../outbound.js";

const conn: WhatsAppConnection = { apiKey: "k", appName: "app", sourcePhone: "+5491100000000" };

function fakeProvider() {
  const sendText = vi.fn(async () => ({ externalId: "txt-1" }));
  const sendTemplate = vi.fn(async () => ({ externalId: "tpl-1" }));
  const provider = { sendText, sendTemplate, sendMedia: vi.fn(), downloadMedia: vi.fn() } as unknown as WhatsAppProvider;
  return { provider, sendText, sendTemplate };
}

const template: OutboundTemplate = { externalId: "gs-tpl-9", name: "seguimiento", language: "es", status: "approved", variables: ["name"] };

describe("dispatchOutbound", () => {
  it("sends text messages with sendText", async () => {
    const f = fakeProvider();
    const r = await dispatchOutbound(f.provider, conn, "+541", { type: "text", body: "hola", contactName: null, template: null });
    expect(r.externalId).toBe("txt-1");
    expect(f.sendText).toHaveBeenCalledWith(conn, "+541", "hola");
    expect(f.sendTemplate).not.toHaveBeenCalled();
  });

  it("sends template messages with sendTemplate using the external id and resolved params", async () => {
    const f = fakeProvider();
    const r = await dispatchOutbound(f.provider, conn, "+541", { type: "template", body: "Hola {{1}}", contactName: "Ana", template });
    expect(r.externalId).toBe("tpl-1");
    expect(f.sendTemplate).toHaveBeenCalledWith(conn, "+541", "gs-tpl-9", ["Ana"]);
    expect(f.sendText).not.toHaveBeenCalled();
  });

  it("sends templates without variables with empty params", async () => {
    const f = fakeProvider();
    await dispatchOutbound(f.provider, conn, "+541", { type: "template", body: "x", contactName: null, template: { ...template, variables: [] } });
    expect(f.sendTemplate).toHaveBeenCalledWith(conn, "+541", "gs-tpl-9", []);
  });

  it.each([
    ["missing template", null],
    ["not approved", { ...template, status: "pending" }],
    ["no external id", { ...template, externalId: null }],
    ["unsupported variable", { ...template, variables: ["price"] }],
  ])("fails unrecoverably on %s without calling the provider", async (_label, tpl) => {
    const f = fakeProvider();
    await expect(
      dispatchOutbound(f.provider, conn, "+541", { type: "template", body: "x", contactName: "Ana", template: tpl as OutboundTemplate | null }),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(f.sendTemplate).not.toHaveBeenCalled();
    expect(f.sendText).not.toHaveBeenCalled();
  });

  it("fails unrecoverably when a name variable has no contact name", async () => {
    const f = fakeProvider();
    await expect(dispatchOutbound(f.provider, conn, "+541", { type: "template", body: "x", contactName: null, template })).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("fails unrecoverably on text without body", async () => {
    const f = fakeProvider();
    await expect(dispatchOutbound(f.provider, conn, "+541", { type: "text", body: null, contactName: null, template: null })).rejects.toBeInstanceOf(UnrecoverableError);
  });
});
