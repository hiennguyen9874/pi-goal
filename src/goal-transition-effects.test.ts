import { test } from "vitest";
import assert from "node:assert/strict";

import { applyGoalTransitionEffects, type GoalTransitionEffectHandlers } from "./goal-transition-effects.ts";

test("applyGoalTransitionEffects invokes each handler once in order", () => {
  const calls: string[] = [];
  const handlers: GoalTransitionEffectHandlers = {
    clearContinuation: () => calls.push("clearContinuation"),
    clearActiveAccounting: () => calls.push("clearActiveAccounting"),
    clearPendingCompletion: () => calls.push("clearPendingCompletion"),
    clearStaleQueuedWork: () => calls.push("clearStaleQueuedWork"),
    resetRecovery: () => calls.push("resetRecovery"),
    clearBudgetWarning: () => calls.push("clearBudgetWarning"),
    markContinuationQueued: (goalId) => calls.push(`markContinuationQueued:${goalId}`),
    syncTools: () => calls.push("syncTools"),
    refreshUi: () => calls.push("refreshUi"),
  };

  applyGoalTransitionEffects([
    { type: "clearContinuation" },
    { type: "markContinuationQueued", goalId: "g" },
    { type: "refreshUi" },
  ], handlers);

  assert.deepEqual(calls, ["clearContinuation", "markContinuationQueued:g", "refreshUi"]);
});
