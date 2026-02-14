/**
 * Simple pricing table for Claude models (per million tokens).
 * Prices as of early 2026.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'claude-sonnet-4-5-20250929': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0 },
};

// Fallback for unrecognized models — use Sonnet pricing
const DEFAULT_PRICING = { input: 3.0, output: 15.0 };

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  // Ollama models are local — free
  if (model.startsWith('ollama:')) return 0;
  const pricing = PRICING[model] || DEFAULT_PRICING;
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

export function getModelPricing(model: string): { input: number; output: number } {
  return PRICING[model] || DEFAULT_PRICING;
}
