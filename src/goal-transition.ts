import { goalsEquivalent, transitionGoal, type GoalState } from "./state.ts";

export type GoalTransitionSource = "command" | "tool" | "runtime" | "recovery";

export type GoalTransitionRequest =
  | { kind: "create_or_replace"; nextGoal: GoalState; source: GoalTransitionSource }
  | { kind: "pause"; now: number }
  | { kind: "resume"; now: number }
  | { kind: "clear" }
  | { kind: "complete"; now: number }
  | { kind: "runtime_accounting"; nextGoal: GoalState }
  | { kind: "recovery_pause"; reason: string; now: number };

export type GoalTransitionEffect =
  | { type: "clearContinuation" }
  | { type: "clearActiveAccounting" }
  | { type: "clearPendingCompletion" }
  | { type: "clearStaleQueuedWork" }
  | { type: "resetRecovery" }
  | { type: "clearBudgetWarning" }
  | { type: "markContinuationQueued"; goalId: string }
  | { type: "syncTools" }
  | { type: "refreshUi" };

export type GoalTransitionPlan = {
  nextGoal: GoalState | null;
  persist: "skip" | "set" | "usage" | "clear";
  effects: GoalTransitionEffect[];
};

function pushEffectOnce(effects: GoalTransitionEffect[], effect: GoalTransitionEffect): void {
  if (effects.some((existing) => existing.type === effect.type)) return;
  effects.push(effect);
}

function requireCurrent(current: GoalState | null, kind: string): GoalState {
  if (!current) throw new Error(`${kind} requires a current goal.`);
  return current;
}

function validateRuntimeAccounting(current: GoalState | null, next: GoalState): void {
  const goal = requireCurrent(current, "runtime_accounting");
  if (next.goalId !== goal.goalId) throw new Error("goalId mismatch during runtime accounting.");
  if (next.objective !== goal.objective) throw new Error("objective mismatch during runtime accounting.");
  if (next.tokenBudget !== goal.tokenBudget) throw new Error("tokenBudget mismatch during runtime accounting.");
  if (next.createdAt !== goal.createdAt) throw new Error("createdAt mismatch during runtime accounting.");
  if (next.tokensUsed < goal.tokensUsed) throw new Error("tokensUsed must not decrease during runtime accounting.");
  if (next.timeUsedSeconds < goal.timeUsedSeconds) throw new Error("timeUsedSeconds must not decrease during runtime accounting.");
  if (next.turnCount < goal.turnCount) throw new Error("turnCount must not decrease during runtime accounting.");
  if (next.continuationCount < goal.continuationCount) throw new Error("continuationCount must not decrease during runtime accounting.");
  if (next.updatedAt < goal.updatedAt) throw new Error("updatedAt must not rewind during runtime accounting.");
  if (next.status === "budget_limited") {
    if (next.tokenBudget === null || next.tokensUsed < next.tokenBudget) {
      throw new Error("budget_limited runtime accounting must be at or above tokenBudget.");
    }
  }
}

export function planGoalTransition(current: GoalState | null, request: GoalTransitionRequest): GoalTransitionPlan {
  const effects: GoalTransitionEffect[] = [];
  const add = (effect: GoalTransitionEffect) => pushEffectOnce(effects, effect);

  switch (request.kind) {
    case "create_or_replace": {
      const goalIdChanged = current?.goalId !== request.nextGoal.goalId;
      if (goalIdChanged) {
        add({ type: "clearContinuation" });
        add({ type: "clearActiveAccounting" });
        add({ type: "clearPendingCompletion" });
        add({ type: "clearStaleQueuedWork" });
        add({ type: "resetRecovery" });
        add({ type: "clearBudgetWarning" });
      }
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return {
        nextGoal: request.nextGoal,
        persist: goalsEquivalent(current, request.nextGoal) ? "skip" : "set",
        effects,
      };
    }

    case "pause": {
      const goal = requireCurrent(current, "pause");
      if (goal.status !== "active") throw new Error("Only active goals can be paused.");
      const nextGoal = transitionGoal(goal, "paused", request.now);
      add({ type: "clearContinuation" });
      add({ type: "clearActiveAccounting" });
      add({ type: "resetRecovery" });
      add({ type: "clearBudgetWarning" });
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal, persist: goalsEquivalent(goal, nextGoal) ? "skip" : "set", effects };
    }

    case "resume": {
      const goal = requireCurrent(current, "resume");
      if (goal.status !== "paused") throw new Error("Only paused goals can be resumed.");
      const nextGoal = transitionGoal(goal, "active", request.now);
      add({ type: "resetRecovery" });
      add({ type: "clearBudgetWarning" });
      add({ type: "markContinuationQueued", goalId: nextGoal.goalId });
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal, persist: goalsEquivalent(goal, nextGoal) ? "skip" : "set", effects };
    }

    case "clear":
      add({ type: "clearContinuation" });
      add({ type: "clearActiveAccounting" });
      add({ type: "clearPendingCompletion" });
      add({ type: "clearStaleQueuedWork" });
      add({ type: "resetRecovery" });
      add({ type: "clearBudgetWarning" });
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal: null, persist: "clear", effects };

    case "complete": {
      const goal = requireCurrent(current, "complete");
      if (goal.status !== "active") throw new Error("Only active goals can be completed.");
      const nextGoal = transitionGoal(goal, "complete", request.now);
      add({ type: "clearContinuation" });
      add({ type: "clearActiveAccounting" });
      add({ type: "clearPendingCompletion" });
      add({ type: "resetRecovery" });
      add({ type: "clearBudgetWarning" });
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal, persist: goalsEquivalent(goal, nextGoal) ? "skip" : "set", effects };
    }

    case "runtime_accounting":
      validateRuntimeAccounting(current, request.nextGoal);
      if (request.nextGoal.status === "budget_limited") {
        add({ type: "clearContinuation" });
        add({ type: "clearActiveAccounting" });
      }
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal: request.nextGoal, persist: "usage", effects };

    case "recovery_pause": {
      const goal = requireCurrent(current, "recovery_pause");
      if (goal.status !== "active") throw new Error("Only active goals can be paused for recovery.");
      const nextGoal = transitionGoal(goal, "paused", request.now);
      add({ type: "clearContinuation" });
      add({ type: "clearActiveAccounting" });
      add({ type: "clearPendingCompletion" });
      add({ type: "clearStaleQueuedWork" });
      add({ type: "clearBudgetWarning" });
      add({ type: "syncTools" });
      add({ type: "refreshUi" });
      return { nextGoal, persist: "set", effects };
    }
  }
}
