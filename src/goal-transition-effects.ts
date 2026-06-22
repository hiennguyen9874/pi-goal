import type { GoalTransitionEffect } from "./goal-transition.ts";

export interface GoalTransitionEffectHandlers {
  clearContinuation(): void;
  clearActiveAccounting(): void;
  clearPendingCompletion(): void;
  clearStaleQueuedWork(): void;
  resetRecovery(): void;
  clearBudgetWarning(): void;
  syncTools(): void;
  refreshUi(): void;
}

export function applyGoalTransitionEffects(
  effects: readonly GoalTransitionEffect[],
  handlers: GoalTransitionEffectHandlers,
): void {
  for (const effect of effects) {
    handlers[effect.type]();
  }
}
