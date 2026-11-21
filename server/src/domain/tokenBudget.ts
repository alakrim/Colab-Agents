import type { EffortLevel, ProviderKind } from './types.js';

export const EFFORT_TOKEN_CEILINGS: Record<EffortLevel, number> = {
  low: 1500,
  medium: 4000,
  high: 8000,
  max: 16000,
};

/**
 * Rolling 5-hour soft subscription budgets (estimated tokens) used for the
 * Fuel Gauge & cooldown warnings so autonomous loops never blindly exhaust caps.
 */
export const PROVIDER_WINDOW_BUDGETS: Record<ProviderKind, { windowHours: number; softTokenCap: number; softMessageCap: number }> = {
  claude: { windowHours: 5, softTokenCap: 180_000, softMessageCap: 45 },
  gemini: { windowHours: 24, softTokenCap: 400_000, softMessageCap: 100 },
  openai: { windowHours: 5, softTokenCap: 200_000, softMessageCap: 50 },
  custom: { windowHours: 24, softTokenCap: 500_000, softMessageCap: 200 },
};

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 3.8));
}

export function truncateToTokenBudget(text: string, maxTokens: number): { text: string; truncated: boolean; tokens: number } {
  const tokens = estimateTokens(text);
  if (tokens <= maxTokens) {
    return { text, truncated: false, tokens };
  }
  const maxChars = Math.max(200, Math.floor(maxTokens * 3.8) - 80);
  const sliced = text.slice(0, maxChars) + '\n... [truncated to enforce effort token ceiling]';
  return { text: sliced, truncated: true, tokens: estimateTokens(sliced) };
}
