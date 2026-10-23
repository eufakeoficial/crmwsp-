import { signNowPaymentsPayload } from "@crmwsp/payments";
import { describe, expect, it, vi } from "vitest";
import { NowPaymentsIpnController } from "./nowpayments-ipn.controller.js";
import type { SubscriptionService } from "./subscription.service.js";

const SECRET = "ipn-test-secret";
const body = { payment_id: 5077125051, payment_status: "finished", order_id: "00000000-0000-4000-8000-0000000000aa", actually_paid: 49.31 };

function setup(secret: string | null = SECRET, known = true) {
  const ingestIpn = vi.fn(async () => known);
  const ctrl = new NowPaymentsIpnController({ ingestIpn } as unknown as SubscriptionService, secret);
  const reply = { status: 0, code(s: number) { this.status = s; return this; }, send: vi.fn() };
  return { ctrl, reply, ingestIpn };
}

describe("NowPaymentsIpnController", () => {
  it("401 and nothing stored on a bad or missing signature", async () => {
    const { ctrl, reply, ingestIpn } = setup();
    await ctrl.receive(body, "ab".repeat(64), reply);
    expect(reply.status).toBe(401);
    await ctrl.receive(body, undefined, reply);
    expect(reply.status).toBe(401);
    expect(ingestIpn).not.toHaveBeenCalled();
  });

  it("401 when the IPN secret is not configured", async () => {
    const { ctrl, reply, ingestIpn } = setup(null);
    await ctrl.receive(body, signNowPaymentsPayload(body, SECRET), reply);
    expect(reply.status).toBe(401);
    expect(ingestIpn).not.toHaveBeenCalled();
  });

  it("verified IPNs are persisted with the payment id normalized to string", async () => {
    const { ctrl, reply, ingestIpn } = setup();
    await ctrl.receive(body, signNowPaymentsPayload(body, SECRET), reply);
    expect(reply.status).toBe(200);
    expect(ingestIpn).toHaveBeenCalledWith("5077125051", "finished", body.order_id, body);
  });

  it("unknown orders are acknowledged (200) without retry", async () => {
    const { ctrl, reply } = setup(SECRET, false);
    await ctrl.receive(body, signNowPaymentsPayload(body, SECRET), reply);
    expect(reply.status).toBe(200);
  });

  it("503 when ingestion fails so NOWPayments retries", async () => {
    const ingestIpn = vi.fn(async () => Promise.reject(new Error("db down")));
    const ctrl = new NowPaymentsIpnController({ ingestIpn } as unknown as SubscriptionService, SECRET);
    const reply = { status: 0, code(s: number) { this.status = s; return this; }, send: vi.fn() };
    await ctrl.receive(body, signNowPaymentsPayload(body, SECRET), reply);
    expect(reply.status).toBe(503);
  });
});
