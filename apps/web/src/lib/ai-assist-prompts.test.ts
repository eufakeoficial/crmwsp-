import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildApiKeyPrompt,
  buildDisplayNamePrompt,
  buildPartnerCredentialsPrompt,
  buildProfilePrompt,
  buildRechargePrompt,
  buildVerifyChannelPrompt,
  buildWebhookPrompt,
} from "./ai-assist-prompts";

const WEBHOOK = "https://api.example.com/webhooks/gupshup/abc123";
const APP = "MiEmpresaApp";
const PHONE = "+5491155551234";

const outputs: Record<string, string> = {
  P1: buildWebhookPrompt({ webhookUrl: WEBHOOK, appName: APP }),
  P2: buildApiKeyPrompt({ appName: APP }),
  P3: buildRechargePrompt({ appName: APP }),
  P4: buildPartnerCredentialsPrompt({ appName: APP }),
  P5: buildDisplayNamePrompt({ phone: PHONE, displayName: "Mi Negocio" }),
  P6: buildProfilePrompt({ phone: PHONE, appName: APP }),
  P7: buildVerifyChannelPrompt({ webhookUrl: WEBHOOK, appName: APP, phone: PHONE, apiKeyHint: "…a1b2" }),
};

describe("ai-assist-prompts", () => {
  it("P1 includes the webhook URL, app name, v2 format and all five events", () => {
    const p = outputs.P1!;
    expect(p).toContain(WEBHOOK);
    expect(p).toContain(APP);
    expect(p).toContain("Gupshup (v2)");
    for (const ev of ["Mensaje", "Enviado", "Entregado", "Leído", "Error"]) expect(p).toContain(ev);
  });

  it("P7 includes webhook URL, app name, phone and the key hint", () => {
    const p = outputs.P7!;
    for (const v of [WEBHOOK, APP, PHONE, "…a1b2"]) expect(p).toContain(v);
  });

  it("P2 warns about browser autofill and P5 about Meta approval", () => {
    expect(outputs.P2).toMatch(/autocompletado/);
    expect(outputs.P5).toMatch(/Meta debe aprobarla/);
  });

  it("every prompt has numbered steps, a handoff rule and a final reload-and-confirm check", () => {
    for (const [name, p] of Object.entries(outputs)) {
      expect(p, name).toMatch(/\n1\. /);
      expect(p, name).toMatch(/detente y pídeme/i);
      const steps = p.split("\n").filter((l) => /^\d+\. /.test(l));
      expect(steps.length, name).toBeGreaterThanOrEqual(4);
      expect(steps[steps.length - 1], name).toMatch(/recarga/i);
      expect(steps[steps.length - 1], name).toMatch(/confirma/i);
    }
  });

  it("builders take a single non-secret input object", () => {
    const builders = [buildWebhookPrompt, buildApiKeyPrompt, buildRechargePrompt, buildPartnerCredentialsPrompt, buildDisplayNamePrompt, buildProfilePrompt, buildVerifyChannelPrompt];
    for (const fn of builders) expect(fn.length).toBe(1);
    const source = readFileSync(new URL("./ai-assist-prompts.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/(apiKey|partnerToken|password|secret)\s*[?:]/i);
  });

  it("no output looks like it carries a secret", () => {
    for (const [name, p] of Object.entries(outputs)) {
      expect(p, name).not.toMatch(/sk_/i);
      expect(p, name).not.toMatch(/apikey\s*[:=]/i);
      expect(p, name).not.toMatch(/token\s*[:=]/i);
      expect(p, name).not.toMatch(/\b[A-Za-z0-9_-]{32,}\b/);
    }
  });
});
