import type { WhatsAppConnection, WhatsAppProvider } from "@crmwsp/whatsapp";
import { UnrecoverableError } from "bullmq";
import { describe, expect, it, vi } from "vitest";
import { dispatchOutbound } from "../outbound.js";

const conn: WhatsAppConnection = { apiKey: "k", appName: "app", sourcePhone: "+5491100000000" };
const key = "tenants/tenant/outbound/conversation/upload.jpg";

describe("outbound image", () => {
  it("sends the signed URL and caption as media", async () => {
    const sendMedia = vi.fn(async () => ({ externalId: "image-1" }));
    const provider = { sendMedia } as unknown as WhatsAppProvider;
    const signedGetUrl = vi.fn(async () => "https://storage.example/signed");
    const result = await dispatchOutbound(provider, conn, "+541", {
      type: "image", body: "Foto", contactName: null, template: null, imageKey: key,
    }, { signedGetUrl } as never);
    expect(result.externalId).toBe("image-1");
    expect(signedGetUrl).toHaveBeenCalledWith(key, 300);
    expect(sendMedia).toHaveBeenCalledWith(conn, "+541", { type: "image", url: "https://storage.example/signed", caption: "Foto" });
  });

  it("rejects an image without an attachment key", async () => {
    const sendMedia = vi.fn();
    await expect(dispatchOutbound({ sendMedia } as unknown as WhatsAppProvider, conn, "+541", {
      type: "image", body: null, contactName: null, template: null,
    })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("rejects an image when storage is unavailable", async () => {
    const sendMedia = vi.fn();
    await expect(dispatchOutbound({ sendMedia } as unknown as WhatsAppProvider, conn, "+541", {
      type: "image", body: null, contactName: null, template: null, imageKey: key,
    })).rejects.toBeInstanceOf(UnrecoverableError);
    expect(sendMedia).not.toHaveBeenCalled();
  });
});
