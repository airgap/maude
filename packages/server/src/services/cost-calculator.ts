/**
 * Simple pricing table for Claude models (per million tokens).
 * Prices as of early 2026.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6':            { input: 15.00, output: 75.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00,  output: 15.00 },
  'claude-haiku-4-5-20251001':  { input: 0.80,  output: 4.00 },
};

// Fallback for unrecognized models — use Sonnet pricing
const DEFAULT_PRICING = { input: 3.00, output: 15.00 };

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function getModelPricing(model: string): { input: number; output: number } {
  return PRICING[model] || DEFAULT_PRICING;
}
