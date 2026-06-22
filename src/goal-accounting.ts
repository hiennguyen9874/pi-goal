import type { UsageDelta } from "./state.ts";

export interface UsageCarrier {
  usage?: Record<string, unknown>;
  metadata?: { usage?: Record<string, unknown> };
  tokens?: Record<string, unknown>;
}

function numberFrom(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

export function extractTokenUsage(message: UsageCarrier | undefined): number {
  const usage = message?.usage ?? message?.metadata?.usage ?? message?.tokens;
  if (!usage) return 0;
  const explicitTotal = numberFrom(usage.totalTokens ?? usage.total);
  if (explicitTotal > 0) return explicitTotal;
  return numberFrom(usage.input ?? usage.inputTokens ?? usage.promptTokens)
    + numberFrom(usage.output ?? usage.outputTokens ?? usage.completionTokens)
    + numberFrom(usage.reasoning ?? usage.reasoningTokens)
    + numberFrom(usage.cacheRead ?? usage.cacheReadTokens)
    + numberFrom(usage.cacheWrite ?? usage.cacheWriteTokens);
}

export function buildGoalUsageDelta(input: {
  message: UsageCarrier | undefined;
  turnStartedAt: number | null;
  now: number;
  hadToolCall: boolean;
  wasContinuation: boolean;
}): UsageDelta {
  return {
    tokensDelta: extractTokenUsage(input.message),
    secondsDelta: input.turnStartedAt === null ? 0 : Math.max(0, Math.floor((input.now - input.turnStartedAt) / 1000)),
    hadToolCall: input.hadToolCall,
    wasContinuation: input.wasContinuation,
    now: input.now,
  };
}
