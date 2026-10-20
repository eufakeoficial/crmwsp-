/*
 * Transcription price table. Unit: USD micro-cents per audio second
 * (1 USD = 100_000_000 micro-cents), same unit as `estimateCost`.
 * whisper-1 is $0.006 / minute = $0.0001 / second (OpenAI public pricing; third-party
 * trackers only, so `verified: false`: estimate for budgets/dashboards, never for billing).
 */
export interface TranscriptionCostEstimate {
  costMinor: number;
  currency: "USD";
  known: boolean;
  verified: boolean;
}

const MICRO_PER_USD = 100_000_000;

export const TRANSCRIPTION_PRICES: Readonly<Record<string, { microCentsPerSecond: number; verified: boolean }>> = {
  "whisper-1": { microCentsPerSecond: Math.round((0.006 / 60) * MICRO_PER_USD), verified: false },
};

export function estimateTranscriptionCost(model: string, seconds: number): TranscriptionCostEstimate {
  const price = TRANSCRIPTION_PRICES[model.trim().toLowerCase()];
  if (!price) return { costMinor: 0, currency: "USD", known: false, verified: false };
  return {
    costMinor: Math.ceil(Math.max(0, seconds) * price.microCentsPerSecond),
    currency: "USD",
    known: true,
    verified: price.verified,
  };
}
