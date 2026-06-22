export const CONTEXT_OVERFLOW_SIGNATURE = "context_overflow";
export const MAX_CONTEXT_COMPACTION_RETRIES = 1;
export const HOST_OVERFLOW_RECOVERY_REASON = "recovering from context overflow";

export interface AssistantErrorMessage {
  role: string;
  stopReason?: string;
  errorMessage?: string;
  usage?: Record<string, unknown>;
}

export interface ErrorRecoveryCounters {
  signature: string | null;
  transientAttempts: number;
  compactionAttempts: number;
}

export type RecoveryAttention =
  | { kind: "pending"; reason: string }
  | { kind: "paused"; reason: string };

const contextOverflowPattern = /context_length_exceeded|prompt is too long|context window|maximum context|tokens\s*>/i;
const nonRetryableProviderLimitPattern = /GoUsageLimitError|FreeUsageLimitError|Monthly usage limit reached|available balance|insufficient_quota|out of budget|quota exceeded|billing/i;
const retryableTransientPattern = /overloaded|rate limit|too many requests|\b429\b|\b500\b|\b502\b|\b503\b|\b504\b|service unavailable|network error|websocket closed|fetch failed|timeout|stream ended before message_stop/i;

export function createErrorRecoveryCounters(): ErrorRecoveryCounters {
  return {
    signature: null,
    transientAttempts: 0,
    compactionAttempts: 0,
  };
}

export function isErrorAssistantMessage(message: unknown): message is AssistantErrorMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as AssistantErrorMessage;
  return candidate.role === "assistant" && candidate.stopReason === "error";
}

export function isSuccessfulAssistantTurn(message: unknown): message is AssistantErrorMessage {
  if (!message || typeof message !== "object") return false;
  const candidate = message as AssistantErrorMessage;
  return candidate.role === "assistant" && candidate.stopReason !== "error";
}

export function isContextOverflowError(errorMessage: string | undefined): boolean {
  return contextOverflowPattern.test(errorMessage ?? "");
}

function isNonRetryableProviderLimit(errorMessage: string | undefined): boolean {
  return nonRetryableProviderLimitPattern.test(errorMessage ?? "");
}

export function isRetryableTransientError(errorMessage: string | undefined): boolean {
  if (isNonRetryableProviderLimit(errorMessage)) return false;
  return retryableTransientPattern.test(errorMessage ?? "");
}

export function failureSignature(errorMessage: string | undefined): string {
  if (isContextOverflowError(errorMessage)) return CONTEXT_OVERFLOW_SIGNATURE;
  const normalized = (errorMessage ?? "unknown_error").trim().toLowerCase().replace(/\s+/g, " ");
  return normalized.slice(0, 200) || "unknown_error";
}

export function countersForFailureSignature(counters: ErrorRecoveryCounters, signature: string): ErrorRecoveryCounters {
  if (counters.signature === signature) return counters;
  counters.signature = signature;
  counters.transientAttempts = 0;
  counters.compactionAttempts = 0;
  return counters;
}

export function createRecoveryPendingAttention(reason: string): RecoveryAttention {
  return { kind: "pending", reason };
}

export function createRecoveryPausedAttention(reason: string): RecoveryAttention {
  return { kind: "paused", reason };
}

export function formatRecoveryAttention(attention: RecoveryAttention | null | undefined): string | undefined {
  if (!attention) return undefined;
  if (attention.kind === "pending") {
    return `Goal recovery pending: ${attention.reason}. Waiting for the provider/host to recover. No action is needed yet; send a message to reset recovery if you want to intervene.`;
  }
  return `Goal needs attention: ${attention.reason}. Use /goal resume after resolving the issue.`;
}

export function isNonRetryableProviderError(errorMessage: string | undefined): boolean {
  return isNonRetryableProviderLimit(errorMessage);
}
