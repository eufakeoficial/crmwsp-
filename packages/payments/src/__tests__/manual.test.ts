import { describe, expect, it } from "vitest";
import { ManualTransferProvider } from "../manual.js";

const reference = { tenantId: "ten_01HZX", kind: "order", id: "ord_01hzy8k2" } as const;
const bank = new ManualTransferProvider({
  method: "bank_transfer",
  accountHolder: "Climatizaciones Vidal S.L.",
  iban: "ES9121000418450200051332",
  notes: "Envíanos el justificante por este chat.",
});

describe("ManualTransferProvider", () => {
  it("builds instructions with a stable concept", () => {
    const i = bank.getInstructions({ amountMinor: 78000, currency: "EUR", reference });
    expect(i.concept).toBe("PED-ORD01HZY");
    expect(i.text).toContain("IBAN: ES9121000418450200051332");
    expect(i.text).toContain("780,00");
    expect(i.text).toContain("Concepto: PED-ORD01HZY");
    expect(ManualTransferProvider.concept({ ...reference, kind: "quote" })).toMatch(/^PRE-/);
  });
  it("supports QR and validates config", () => {
    const qr = new ManualTransferProvider({ method: "qr", accountHolder: "X", qrImageUrl: "https://cdn.test/qr.png" });
    expect(qr.getInstructions({ amountMinor: 500, currency: "EUR", reference }).qrImageUrl).toBe("https://cdn.test/qr.png");
    expect(() => new ManualTransferProvider({ method: "bank_transfer", accountHolder: "X" })).toThrow();
    expect(() => new ManualTransferProvider({ method: "qr", accountHolder: "X", qrImageUrl: "http://x" })).toThrow();
  });
  it("has no webhook and creates no link", () => {
    expect(bank.supportsWebhook).toBe(false);
    expect("createPaymentLink" in bank).toBe(false);
  });
  it("confirmation is always reconciliation and needs a human plus a reason", () => {
    const c = bank.confirm({ reference, amountMinor: 78000, currency: "eur", confirmedBy: "usr_1", reason: "Visto en extracto BBVA 20/10" });
    expect(c).toMatchObject({ verifiedBy: "reconciliation", currency: "EUR", confirmedBy: "usr_1" });
    expect(c.confirmedAt).toBeInstanceOf(Date);
    const bad = { reference, amountMinor: 1, currency: "EUR", confirmedBy: "usr_1", reason: "ok" };
    expect(() => bank.confirm(bad)).toThrow(/reason/);
    expect(() => bank.confirm({ ...bad, reason: "Visto en extracto", confirmedBy: " " })).toThrow(/confirmedBy/);
    expect(() => bank.confirm({ ...bad, reason: "Visto en extracto", verifiedBy: "webhook" } as never).verifiedBy).not.toThrow();
    expect(bank.confirm({ ...bad, reason: "Visto en extracto", verifiedBy: "webhook" } as never).verifiedBy).toBe("reconciliation");
  });
});
