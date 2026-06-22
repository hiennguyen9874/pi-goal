import {
  CONTEXT_OVERFLOW_SIGNATURE,
  MAX_CONTEXT_COMPACTION_RETRIES,
  countersForFailureSignature,
  createErrorRecoveryCounters,
  createRecoveryPausedAttention,
  createRecoveryPendingAttention,
  failureSignature,
  isContextOverflowError,
  isNonRetryableProviderError,
  isRetryableTransientError,
  isSuccessfulAssistantTurn,
  type AssistantErrorMessage,
  type ErrorRecoveryCounters,
  type RecoveryAttention,
} from "./recovery.ts";

export type RecoveryAction =
  | { type: "noop" }
  | { type: "pending"; reason: string }
  | { type: "pause"; reason: string };

export interface GoalRecoveryMachineState {
  counters: ErrorRecoveryCounters;
  attention: RecoveryAttention | null;
  needsUserStartTurn: boolean;
}

export function createGoalRecoveryMachine(): GoalRecoveryMachineState {
  return {
    counters: createErrorRecoveryCounters(),
    attention: null,
    needsUserStartTurn: false,
  };
}

export function resetRecoveryMachine(state: GoalRecoveryMachineState): void {
  state.counters = createErrorRecoveryCounters();
  state.attention = null;
  state.needsUserStartTurn = false;
}

export function onRecoveryUserInput(state: GoalRecoveryMachineState): void {
  resetRecoveryMachine(state);
}

export function onRecoverySuccessfulTurn(state: GoalRecoveryMachineState, message: unknown): boolean {
  if (!isSuccessfulAssistantTurn(message)) return false;
  resetRecoveryMachine(state);
  return true;
}

function planContextOverflowRecovery(state: GoalRecoveryMachineState): RecoveryAction {
  countersForFailureSignature(state.counters, CONTEXT_OVERFLOW_SIGNATURE);
  state.counters.compactionAttempts += 1;
  if (state.counters.compactionAttempts <= MAX_CONTEXT_COMPACTION_RETRIES) {
    state.attention = null;
    return { type: "noop" };
  }

  const reason = "context window recovery failed after compaction retry";
  state.attention = createRecoveryPausedAttention(reason);
  state.needsUserStartTurn = false;
  return { type: "pause", reason };
}

export function planRecoveryForAssistantError(
  state: GoalRecoveryMachineState,
  message: AssistantErrorMessage,
): RecoveryAction {
  const errorMessage = message.errorMessage ?? "provider error";

  if (isContextOverflowError(errorMessage)) return planContextOverflowRecovery(state);

  const signature = failureSignature(errorMessage);
  countersForFailureSignature(state.counters, signature);

  if (isNonRetryableProviderError(errorMessage)) {
    const reason = `non-retryable provider error: ${errorMessage}`;
    state.attention = createRecoveryPausedAttention(reason);
    state.needsUserStartTurn = false;
    return { type: "pause", reason };
  }

  if (isRetryableTransientError(errorMessage)) {
    state.counters.transientAttempts += 1;
    const reason = `provider error (${errorMessage})`;
    state.attention = createRecoveryPendingAttention(reason);
    return { type: "pending", reason };
  }

  const reason = `non-retryable provider error: ${errorMessage}`;
  state.attention = createRecoveryPausedAttention(reason);
  state.needsUserStartTurn = false;
  return { type: "pause", reason };
}

export function planRecoveryForSilentContextOverflow(state: GoalRecoveryMachineState): RecoveryAction {
  return planContextOverflowRecovery(state);
}

export function recoveryBlocksContinuation(state: GoalRecoveryMachineState): boolean {
  return state.needsUserStartTurn || state.attention?.kind === "paused" || state.attention?.kind === "pending";
}

export function requireRecoveryUserStart(state: GoalRecoveryMachineState): void {
  state.needsUserStartTurn = true;
}
