import type { TokenUsage } from "./provider/types.js";

/*
 * Price table. Unit: USD micro-cents (1 USD = 100 cents = 100_000_000 micro-cents)
 * per 1M tokens. `costMinor` from `estimateCost` uses the same unit (integer, rounded up).
 *
 * Sources (consulted 2026-10-20; third-party trackers, the vendors' official pages
 * could not be fetched from this environment and must be re-checked before billing):
 * - OpenAI gpt-5-mini $0.25 in / $2.00 out; text-embedding-3-small $0.02 in:
 *   https://modelcompare.dev/pricing/openai-api-pricing (dated 2026-05-12),
 *   https://computeprices.com/providers/openai/models/gpt-5-mini,
 *   https://curlscape.com/blog/openai-api-pricing-guide-2026
 *   Official: https://developers.openai.com/api/docs/pricing
 * - DeepSeek deepseek-chat (V3.2) $0.28 in (cache miss) / $0.42 out:
 *   https://www.nxcode.io/pt/resources/news/deepseek-api-pricing-complete-guide-2026,
 *   https://usagepricing.com/ai-token-pricing/deepseek
 *   Official: https://api-docs.deepseek.com/quick_start/pricing
 * - OpenRouter passes through the upstream vendor price for `openai/*` routes; the
 *   OpenRouter entry mirrors the OpenAI price above (https://openrouter.ai/openai/gpt-5-mini).
 *
 * Models whose price could not be confirmed are deliberately absent: `estimateCost`
 * then returns `known: false` instead of guessing.
 */

export interface ModelPrice {
  inputMicroCentsPer1M: number;
  outputMicroCentsPer1M: number;
  /**
   * True only once the price was checked against the vendor's official pricing page.
   * Unverified prices are estimates for dashboards/limits and MUST NOT be used to bill.
   */
  verified: boolean;
}

const usd = (dollars: number): number => Math.round(dollars * 100_000_000);

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  // verified: false — official pages unreachable from the build environment (gate F2-B, 2026-10-20).
  "gpt-5-mini": { inputMicroCentsPer1M: usd(0.25), outputMicroCentsPer1M: usd(2.0), verified: false },
  "text-embedding-3-small": { inputMicroCentsPer1M: usd(0.02), outputMicroCentsPer1M: 0, verified: false },
  "openai/gpt-5-mini": { inputMicroCentsPer1M: usd(0.25), outputMicroCentsPer1M: usd(2.0), verified: false },
  "deepseek-chat": { inputMicroCentsPer1M: usd(0.28), outputMicroCentsPer1M: usd(0.42), verified: false },
};

export interface CostEstimate {
  costMinor: number;
  currency: "USD";
  known: boolean;
  /** False when the price is unverified (or unknown): estimate only, never bill with it. */
  verified: boolean;
}

/** Strips a dated snapshot suffix (e.g. `gpt-5-mini-2025-08-07`) to find the base price. */
function findPrice(model: string): ModelPrice | undefined {
  const key = model.trim().toLowerCase();
  return MODEL_PRICES[key] ?? MODEL_PRICES[key.replace(/-\d{4}-\d{2}-\d{2}$/, "")];
}

export function estimateCost(model: string, usage: Partial<TokenUsage>): CostEstimate {
  const price = findPrice(model);
  if (!price) return { costMinor: 0, currency: "USD", known: false, verified: false };
  const inTok = Math.max(0, usage.inputTokens ?? 0);
  const outTok = Math.max(0, usage.outputTokens ?? 0);
  const cost = (inTok * price.inputMicroCentsPer1M + outTok * price.outputMicroCentsPer1M) / 1_000_000;
  return { costMinor: Math.ceil(cost), currency: "USD", known: true, verified: price.verified };
}
