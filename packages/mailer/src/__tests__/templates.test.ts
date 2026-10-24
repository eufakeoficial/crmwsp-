import { PLANS } from "@crmwsp/billing";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EMAIL_ASSETS_URL,
  EMAIL_KEYS,
  EMAIL_TEMPLATES,
  emailContextFromEnv,
  renderTemplate,
  sampleEmail,
  templateMessage,
} from "../index.js";

const ctx = emailContextFromEnv({ PUBLIC_WEB_URL: "https://www.vendemas.chat" });

describe("branded templates", () => {
  it.each(EMAIL_KEYS)("%s renders subject, text and https-only links without undefined", (key) => {
    const email = sampleEmail(key, ctx);
    expect(email.subject.length).toBeGreaterThan(0);
    expect(email.text).toContain("Vende+ WSP");
    expect(email.html + email.text).not.toMatch(/undefined|null|\[object/);
    for (const [, href] of email.html.matchAll(/href="([^"]+)"/g)) expect(href).toMatch(/^https:\/\//);
    for (const [, src] of email.html.matchAll(/<img[^>]+src="([^"]+)"/g)) expect(src).toMatch(/^https:\/\//);
  });

  it("uses the absolute https logo by default", () => {
    expect(ctx.assetsUrl).toBe(DEFAULT_EMAIL_ASSETS_URL);
    expect(sampleEmail("bienvenida", ctx).html).toContain('src="https://www.vendemas.chat/brand/logo-on-dark.png"');
    expect(emailContextFromEnv({ EMAIL_ASSETS_URL: "http://insecure.test" }).assetsUrl).toBe(DEFAULT_EMAIL_ASSETS_URL);
    expect(emailContextFromEnv({}).siteUrl).toBe("https://www.vendemas.chat");
  });

  it("payment samples use the real plan prices", () => {
    const pro = PLANS.pro.priceMonthlyUsd;
    expect(EMAIL_TEMPLATES["pago-confirmado"].sample.amount).toBe(`${pro},00 USD`);
    expect(EMAIL_TEMPLATES["pago-por-vencer"].sample.amount).toBe(`${pro},00 USD`);
  });

  it("coupon grants never claim a payment was received", () => {
    const email = renderTemplate("pago-confirmado", { ...EMAIL_TEMPLATES["pago-confirmado"].sample, coupon: true, amount: "0,00 USD", cycle: null }, ctx);
    expect(email.subject).toBe("Cupón aplicado: plan Pro");
    expect(email.text).toContain("Sin costo (cupón)");
    expect(email.text).not.toContain("Recibimos");
  });

  it("annual payments say so in the subject", () => {
    const email = renderTemplate("pago-confirmado", { ...EMAIL_TEMPLATES["pago-confirmado"].sample, cycle: "anual", amount: "890,00 USD" }, ctx);
    expect(email.subject).toBe("Pago confirmado: plan Pro anual");
  });

  it("escapes caller data and keeps the invitation subject", () => {
    const msg = templateMessage("a@b.test", "invitacion-equipo", { tenantName: "<b>X</b>", role: "agent", inviterName: null, link: "https://x.test/invite/t", days: 7 }, ctx);
    expect(msg.subject).toBe("Invitación para unirte a <b>X</b>");
    expect(msg.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(msg.html).not.toContain("<b>X</b>");
    expect(msg.headers).toBeUndefined();
  });

  it("rejects non-http links", () => {
    expect(() => renderTemplate("cuenta-aprobada", { name: null, tenantName: "T", appUrl: "javascript:alert(1)" }, ctx)).toThrow();
  });
});
