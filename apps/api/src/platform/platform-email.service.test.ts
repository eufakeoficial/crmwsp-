import { describe, expect, it, vi } from "vitest";
import { RateLimitedError, ValidationError } from "@crmwsp/contracts";
import type { Mailer } from "@crmwsp/mailer";
import { MemoryCounterStore } from "../common/rate-limit-store.js";
import type { PlatformEmailRepository } from "./platform-email.repository.js";
import { PlatformEmailService } from "./platform-email.service.js";

const TICKET = "00000000-0000-4000-8000-0000000000aa";
const summary = {
  id: TICKET,
  number: 42,
  subject: "Consulta",
  status: "open" as const,
  priority: "normal" as const,
  contactEmail: "ana@cliente.co",
  contactName: "Ana",
  tenant: null,
  assignee: null,
  snippet: "hola",
  unread: false,
  lastMessageAt: new Date().toISOString(),
};
const msg = (id: string, direction: "inbound" | "outbound" | "note", emailMessageId: string | null) => ({
  id,
  direction,
  authorName: null,
  fromEmail: null,
  toEmails: [],
  body: "x",
  html: null,
  attachments: [],
  autoReason: null,
  createdAt: new Date().toISOString(),
  emailMessageId,
  storedAttachments: [{ id: "att1", emailId: "em1", filename: "f.pdf", contentType: "application/pdf", size: 3 }],
});

function setup() {
  const repo = {
    get: vi.fn(async () => summary),
    messages: vi.fn(async () => [msg("1", "inbound", "<a@c>"), msg("2", "outbound", "<b@v>"), msg("3", "note", null), msg("4", "inbound", "<c@c>")]),
    markRead: vi.fn(async () => undefined),
    recordOutbound: vi.fn(async () => ({ ticketId: TICKET, tenantId: null })),
  } as unknown as PlatformEmailRepository;
  const send = vi.fn(async (_m: unknown) => ({ messageId: "x" }));
  const hub = { publish: vi.fn(async () => undefined), publishPlatformSupport: vi.fn(async () => undefined) };
  const svc = new PlatformEmailService(repo, hub as never, { send } as Mailer, null, new MemoryCounterStore());
  return { svc, repo, send, hub };
}

describe("PlatformEmailService", () => {
  it("replies from contacto@ with threading headers and the ticket token", async () => {
    const { svc, send, repo, hub } = setup();
    await svc.reply("admin", TICKET, "Gracias", "1.1.1.1");
    const m = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(m.from).toBe("Vende+ WSP <contacto@vendemas.chat>");
    expect(m.to).toBe("ana@cliente.co");
    expect(m.subject).toBe("Re: Consulta [Ticket #42]");
    expect(m.inReplyTo).toBe("<c@c>");
    expect(m.references).toEqual(["<a@c>", "<b@v>", "<c@c>"]);
    expect(String(m.messageId)).toMatch(/^<[0-9a-f-]+@vendemas\.chat>$/);
    expect(repo.recordOutbound).toHaveBeenCalledOnce();
    expect(hub.publish).not.toHaveBeenCalled(); // external ticket: no tenant channel
    expect(hub.publishPlatformSupport).toHaveBeenCalled();
  });

  it("does not record when the mailer fails", async () => {
    const { svc, send, repo } = setup();
    send.mockRejectedValueOnce(new Error("smtp"));
    await expect(svc.reply("admin", TICKET, "x", null)).rejects.toThrow();
    expect(repo.recordOutbound).not.toHaveBeenCalled();
  });

  it("rate-limits outbound mail per admin", async () => {
    const { svc } = setup();
    for (let i = 0; i < 60; i++) await svc.compose("admin", "x@cliente.co", "Hola", "b", null);
    await expect(svc.compose("admin", "x@cliente.co", "Hola", "b", null)).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("refuses composing to the platform domain or invalid addresses", async () => {
    const { svc } = setup();
    await expect(svc.compose("admin", "contacto@vendemas.chat", "x", "y", null)).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.compose("admin", "a@b.co\r\nBcc: z@z.z", "x", "y", null)).rejects.toBeInstanceOf(ValidationError);
  });

  it("serves only attachments that belong to the thread", async () => {
    const { svc } = setup();
    await expect(svc.attachment("admin", TICKET, "other")).rejects.toThrow();
  });
});
