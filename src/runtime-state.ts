import { createGoalRecoveryMachine, type GoalRecoveryMachineState } from "./recovery-machine.ts";

export interface GoalRuntimeState {
  awaitingContinuationGoalId: string | null;
  continuationGeneration: number;
  pendingContinuationGoalId: string | null;
  pendingContinuationMessage: string | null;
  pendingContinuationGeneration: number;
  activeTurnGoalId: string | null;
  activeTurnStartedAt: number | null;
  currentTurnHadToolCall: boolean;
  currentTurnIsContinuation: boolean;
  pendingCompletionGoalId: string | null;
  toolsRestricted: boolean;
  currentTurnQueuedGoalId: string | null;
  currentTurnIsStaleQueuedWork: boolean;
  recovery: GoalRecoveryMachineState;
  clearActiveTurnAccounting(): void;
  clearQueuedTurnState(): void;
}

export function createGoalRuntimeState(): GoalRuntimeState {
  const state: GoalRuntimeState = {
    awaitingContinuationGoalId: null,
    continuationGeneration: 0,
    pendingContinuationGoalId: null,
    pendingContinuationMessage: null,
    pendingContinuationGeneration: 0,
    activeTurnGoalId: null,
    activeTurnStartedAt: null,
    currentTurnHadToolCall: false,
    currentTurnIsContinuation: false,
    pendingCompletionGoalId: null,
    toolsRestricted: false,
    currentTurnQueuedGoalId: null,
    currentTurnIsStaleQueuedWork: false,
    recovery: createGoalRecoveryMachine(),
    clearActiveTurnAccounting() {
      state.activeTurnGoalId = null;
      state.activeTurnStartedAt = null;
      state.currentTurnHadToolCall = false;
      state.currentTurnIsContinuation = false;
    },
    clearQueuedTurnState() {
      state.currentTurnQueuedGoalId = null;
      state.currentTurnIsStaleQueuedWork = false;
    },
  };
  return state;
}
