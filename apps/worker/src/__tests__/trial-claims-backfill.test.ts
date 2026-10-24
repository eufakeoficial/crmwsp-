import type { Database } from "@crmwsp/db";
import { describe, expect, it, vi } from "vitest";
import { runTrialClaimsBackfill } from "../subscription-billing/index.js";

const SECRET = "k".repeat(32);

describe("runTrialClaimsBackfill", () => {
  it("records a hashed phone claim per pending channel, never the plaintext", async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (q: unknown) => {
      const text = JSON.stringify(q);
      calls.push(text);
      if (text.includes("trial_claims_pending_channels")) return [{ channel_id: "c1", phone_e164: "+59170000001" }];
      return [{ ok: true }];
    });
    const n = await runTrialClaimsBackfill({ db: { execute } as unknown as Database, trialIdentitySecret: SECRET });
    expect(n).toBe(1);
    const record = calls.find((c) => c.includes("trial_claims_record")) ?? "";
    expect(record).toMatch(/phone:[0-9a-f]{64}/);
    expect(record).not.toContain("59170000001");
  });

  it("does nothing without the secret", async () => {
    const execute = vi.fn();
    expect(await runTrialClaimsBackfill({ db: { execute } as unknown as Database })).toBe(0);
    expect(execute).not.toHaveBeenCalled();
  });
});
