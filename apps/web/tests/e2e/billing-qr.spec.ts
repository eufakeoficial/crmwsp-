import { expect, test } from "./support";

const ADDRESS = "0xAbC0000000000000000000000000000000000123";

const charge = {
  id: "77777777-7777-4777-8777-777777777777",
  plan: "pro",
  period: "monthly",
  status: "pending",
  providerStatus: "waiting",
  priceAmount: "49",
  priceCurrency: "usd",
  payCurrency: "usdtbsc",
  payAmount: "49.5",
  payAddress: ADDRESS,
  actuallyPaid: null,
  qrData: ADDRESS,
  periodStart: null,
  periodEnd: null,
  listPriceAmount: "49",
  discountAmount: "0.00",
  couponCode: null,
  referralCredits: 0,
  verifiedBy: null,
  periodDays: 30,
  createdAt: "2026-01-15T12:00:00.000Z",
};

test("suscripción: el cargo pendiente muestra el QR, la dirección y el monto", async ({ page, api }) => {
  api.on("GET", "/billing/plan", () => ({
    json: {
      plan: { id: "pro", name: "Pro", priceMonthlyUsd: 49, priceAnnualUsd: 490 },
      period: "2026-01",
      usage: [],
      billingProvider: "nowpayments",
      subscription: { access: "active", paidUntil: null, graceDays: 3, setupEndsAt: null, trialEndsAt: null, daysLeft: null },
    },
  }));
  api.on("GET", "/billing/subscription/charges", () => ({ json: { items: [charge] } }));
  api.on("GET", `/billing/subscription/charges/${charge.id}`, () => ({ json: charge }));

  await page.goto("/app/settings/billing");

  const qr = page.getByRole("img", { name: "Código QR para pagar con USDT" });
  await expect(qr).toBeVisible();
  await expect(qr.locator("svg")).toBeVisible();
  await expect(page.getByTestId("pay-address")).toHaveText(ADDRESS);
  await expect(page.getByText("49.5 USDTBSC")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar dirección" })).toBeVisible();
});
