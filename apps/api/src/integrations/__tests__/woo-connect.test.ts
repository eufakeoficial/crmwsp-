import { describe, expect, it } from "vitest";
import { AppError } from "@crmwsp/contracts";
import type { CipherBox } from "@crmwsp/crypto";
import type { Transaction } from "@crmwsp/db";
import { MemoryCounterStore } from "../../common/rate-limit-store.js";
import { formatConnectCode, generateConnectCode, hashConnectCode } from "../connect-code.js";
import type { ConnectCodeRepository, ConsumedConnectCode } from "../connect-code.repository.js";
import { WooConnectController } from "../woo-connect.controller.js";
import { WooConnectService } from "../woo-connect.service.js";

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const CODE = "ABCDEFGHJK";

const fakeCipher = {
  encrypt: (plain: string, ctx: { tenantId: string; purpose: string }) => Buffer.from(`${ctx.tenantId}|${ctx.purpose}|${plain}`),
} as unknown as CipherBox;

interface Inserted {
  values: Record<string, unknown>;
}

/** Minimal drizzle-like tx: records inserts; `returning()` echoes the row with an id. */
function fakeTx(sink: Inserted[]): Transaction {
  const insert = () => {
    const entry: Inserted = { values: {} };
    const chain = {
      values(v: Record<string, unknown>) {
        entry.values = v;
        sink.push(entry);
        return chain;
      },
      onConflictDoUpdate() {
        return chain;
      },
      async returning() {
        return [{ id: "33333333-3333-4333-8333-333333333333", ...entry.values }];
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(undefined).then(resolve);
      },
    };
    return chain;
  };
  return { insert } as unknown as Transaction;
}

/** In-memory codes: single use, expiry, rollback when `fn` throws. */
class FakeCodes implements ConnectCodeRepository {
  codes = new Map<string, { used: boolean; expired: boolean }>();
  inserts: Inserted[] = [];

  add(code: string, opts: { expired?: boolean } = {}): void {
    this.codes.set(hashConnectCode(code).toString("hex"), { used: false, expired: !!opts.expired });
  }

  async issue(): Promise<Date | null> {
    return new Date();
  }

  async consumeInTenant<T>(hash: Buffer, fn: (code: ConsumedConnectCode, tx: Transaction) => Promise<T>): Promise<T | null> {
    const c = this.codes.get(hash.toString("hex"));
    if (!c || c.used || c.expired) return null;
    c.used = true;
    try {
      return await fn({ tenantId: TENANT, userId: USER, tenantName: "Tienda Ana" }, fakeTx(this.inserts));
    } catch (err) {
      c.used = false;
      throw err;
    }
  }
}

interface Sent {
  status?: number;
  payload?: unknown;
}
const fakeReply = (sent: Sent) => {
  const reply = {
    code(s: number) {
      sent.status = s;
      return reply;
    },
    send(p?: unknown) {
      sent.payload = p;
      return undefined;
    },
  };
  return reply;
};

const body = (over: Record<string, unknown> = {}) => ({
  code: "abcd-efgh-jk",
  shopUrl: "https://shop.example.com",
  consumerKey: "ck_0123456789abcdef",
  consumerSecret: "cs_0123456789abcdef",
  webhookSecret: "a-very-long-webhook-secret",
  ...over,
});

function setup() {
  const codes = new FakeCodes();
  codes.add(CODE);
  const service = new WooConnectService(codes, fakeCipher, new MemoryCounterStore());
  const controller = new WooConnectController(service);
  const call = async (b: unknown, ip = "203.0.113.7") => {
    const sent: Sent = {};
    await controller.connect(b, { headers: {}, ip }, fakeReply(sent));
    return sent;
  };
  return { codes, service, call };
}

const statusOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 200;
  } catch (err) {
    return err instanceof AppError ? err.httpStatus : -1;
  }
};

describe("woocommerce connect code", () => {
  it("generates 10 chars from the safe alphabet and formats XXXX-XXXX-XX", () => {
    for (let i = 0; i < 50; i++) expect(generateConnectCode()).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    expect(formatConnectCode(CODE)).toBe("ABCD-EFGH-JK");
  });

  it("valid code: upserts the woocommerce connection for the code's tenant, encrypted, and returns the webhook URL", async () => {
    const { codes, call } = setup();
    const sent = await call(body());
    expect(sent.status).toBe(200);
    const res = sent.payload as { webhookUrl: string; tenantName: string };
    expect(res.tenantName).toBe("Tienda Ana");
    expect(res.webhookUrl).toMatch(/\/webhooks\/commerce\/woocommerce\/[A-Za-z0-9_-]+$/);
    const [conn, audit] = codes.inserts;
    expect(conn?.values["tenantId"]).toBe(TENANT);
    expect(conn?.values["provider"]).toBe("woocommerce");
    expect(conn?.values["shopDomain"]).toBe("https://shop.example.com");
    expect(String(conn?.values["accessTokenEncrypted"])).toContain("commerce_access_token:woocommerce|ck_0123456789abcdef:cs_");
    expect(String(conn?.values["webhookSecretEncrypted"])).toContain("commerce_webhook_secret:woocommerce|");
    expect(audit?.values["actorId"]).toBe(USER);
    expect(JSON.stringify(audit?.values["diff"])).not.toContain("cs_0123456789abcdef");
  });

  it("used, expired and unknown codes get a bare 401", async () => {
    const { codes, call } = setup();
    expect((await call(body())).status).toBe(200);
    const reused = await call(body());
    expect(reused).toEqual({ status: 401, payload: undefined });
    codes.add("ZZZZZZZZZZ", { expired: true });
    expect((await call(body({ code: "ZZZZ-ZZZZ-ZZ" }))).status).toBe(401);
    expect((await call(body({ code: "XXXX-XXXX-XX" }))).status).toBe(401);
  });

  it("bad key format or http shop URL → 400 without burning the code", async () => {
    const { service, call } = setup();
    expect(await statusOf(service.connect(body({ consumerKey: "nope" }), "198.51.100.1"))).toBe(400);
    expect(await statusOf(service.connect(body({ shopUrl: "http://shop.example.com" }), "198.51.100.1"))).toBe(400);
    expect((await call(body())).status).toBe(200);
  });

  it("rate limits per IP (10 / 15 min)", async () => {
    const { service } = setup();
    for (let i = 0; i < 10; i++) expect(await statusOf(service.connect({}, "192.0.2.9"))).toBe(400);
    expect(await statusOf(service.connect({}, "192.0.2.9"))).toBe(429);
    expect(await statusOf(service.connect({}, "192.0.2.10"))).toBe(400);
  });
});
