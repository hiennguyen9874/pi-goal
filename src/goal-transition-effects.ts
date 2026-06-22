import type { GoalTransitionEffect } from "./goal-transition.ts";

export interface GoalTransitionEffectHandlers {
  clearContinuation(): void;
  clearActiveAccounting(): void;
  clearPendingCompletion(): void;
  clearStaleQueuedWork(): void;
  resetRecovery(): void;
  clearBudgetWarning(): void;
  markContinuationQueued(goalId: string): void;
  syncTools(): void;
  refreshUi(): void;
}

export function applyGoalTransitionEffects(
  effects: readonly GoalTransitionEffect[],
  handlers: GoalTransitionEffectHandlers,
): void {
  for (const effect of effects) {
    if (effect.type === "markContinuationQueued") handlers.markContinuationQueued(effect.goalId);
    else handlers[effect.type]();
  }
}
