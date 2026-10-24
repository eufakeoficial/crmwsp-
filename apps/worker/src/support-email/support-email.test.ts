import { describe, expect, it } from "vitest";
import { toIngestInput } from "./index.js";

const base = {
  id: "em_1",
  from: "Ana Pérez <Ana@Cliente.co>",
  to: ["Vende+ <contacto@vendemas.chat>"],
  subject: "Re: Consulta [Ticket #12]",
  html: '<p>Hola</p><img src="https://track.example/p.gif"><script>x()</script>',
  text: null,
  headers: { "In-Reply-To": "<m1@vendemas.chat>", References: "<m0@c> <m1@vendemas.chat>", "Message-ID": "<abc@cliente.co>" },
  messageId: null,
  attachments: [{ id: "a1", filename: "f.pdf", contentType: "application/pdf", size: 9 }],
};

describe("toIngestInput", () => {
  it("maps a received email into sanitized ingest arguments", () => {
    const i = toIngestInput(base)!;
    expect(i.fromEmail).toBe("ana@cliente.co");
    expect(i.fromName).toBe("Ana Pérez");
    expect(i.to).toEqual(["contacto@vendemas.chat"]);
    expect(i.messageId).toBe("<abc@cliente.co>");
    expect(i.refs).toEqual(["<m1@vendemas.chat>", "<m0@c>"]);
    expect(i.ticketNumber).toBe(12);
    expect(i.subjectNorm).toBe("consulta");
    expect(i.html).not.toMatch(/script|track\.example/);
    expect(i.text).toBe("Hola");
    expect(i.attachments[0]).toMatchObject({ id: "a1", emailId: "em_1" });
    expect(i.autoReason).toBeNull();
  });
  it("flags auto-replies and rejects senders without an address", () => {
    expect(toIngestInput({ ...base, headers: { "Auto-Submitted": "auto-replied" } })!.autoReason).toBe("auto_submitted");
    expect(toIngestInput({ ...base, from: "nobody" })).toBeNull();
  });
});
