import { test } from "vitest";
import assert from "node:assert/strict";

import { createGoal, type GoalState } from "./state.ts";
import { planGoalTransition, type GoalTransitionEffect } from "./goal-transition.ts";

function activeGoal(overrides: Partial<GoalState> = {}): GoalState {
  return {
    version: 1,
    goalId: "goal-1",
    objective: "Ship feature",
    status: "active",
    tokenBudget: null,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    turnCount: 0,
    continuationCount: 0,
    lastContinuationHadToolCall: true,
    continuationSuppressed: false,
    continuationScheduled: false,
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

function effectTypes(effects: readonly GoalTransitionEffect[]): string[] {
  return effects.map((effect) => effect.type);
}

test("create_or_replace new goal persists set and clears old runtime state", () => {
  const current = activeGoal({ goalId: "old" });
  const next = createGoal("New", 100, { goalId: "new", now: 200 });

  const plan = planGoalTransition(current, { kind: "create_or_replace", nextGoal: next, source: "tool" });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.goalId, "new");
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "clearPendingCompletion",
    "clearStaleQueuedWork",
    "resetRecovery",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});

test("pause active goal persists set and clears continuation/accounting/recovery", () => {
  const current = activeGoal({ continuationScheduled: true });
  const plan = planGoalTransition(current, { kind: "pause", now: 200 });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "paused");
  assert.equal(plan.nextGoal?.continuationScheduled, false);
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "resetRecovery",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});

test("resume paused goal clears suppression without queuing transition effect", () => {
  const current = activeGoal({ status: "paused", continuationSuppressed: true, lastContinuationHadToolCall: false });
  const plan = planGoalTransition(current, { kind: "resume", now: 200 });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "active");
  assert.equal(plan.nextGoal?.continuationSuppressed, false);
  assert.equal(plan.nextGoal?.lastContinuationHadToolCall, true);
  assert.deepEqual(effectTypes(plan.effects), [
    "resetRecovery",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});

test("runtime accounting rejects goal identity changes", () => {
  const current = activeGoal({ goalId: "current" });
  const next = activeGoal({ goalId: "other", tokensUsed: 1, updatedAt: 200 });

  assert.throws(
    () => planGoalTransition(current, { kind: "runtime_accounting", nextGoal: next }),
    /goalId mismatch/i,
  );
});

test("runtime accounting rejects decreasing usage", () => {
  const current = activeGoal({ tokensUsed: 10, timeUsedSeconds: 5, updatedAt: 100 });
  const next = { ...current, tokensUsed: 9, updatedAt: 200 };

  assert.throws(
    () => planGoalTransition(current, { kind: "runtime_accounting", nextGoal: next }),
    /tokensUsed must not decrease/i,
  );
});

test("budget_limited accounting requires usage at or over budget", () => {
  const current = activeGoal({ tokenBudget: 100, tokensUsed: 50 });
  const next = { ...current, status: "budget_limited" as const, tokensUsed: 99, updatedAt: 200 };

  assert.throws(
    () => planGoalTransition(current, { kind: "runtime_accounting", nextGoal: next }),
    /at or above tokenBudget/i,
  );
});

test("budget_limited accounting clears continuation and active accounting", () => {
  const current = activeGoal({ tokenBudget: 100, tokensUsed: 90 });
  const next = { ...current, status: "budget_limited" as const, tokensUsed: 100, updatedAt: 200 };

  const plan = planGoalTransition(current, { kind: "runtime_accounting", nextGoal: next });

  assert.equal(plan.persist, "usage");
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "syncTools",
    "refreshUi",
  ]);
});

test("complete active goal persists set and clears terminal runtime state", () => {
  const current = activeGoal({ continuationScheduled: true });
  const plan = planGoalTransition(current, { kind: "complete", now: 200 });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "complete");
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "clearPendingCompletion",
    "resetRecovery",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});

test("recovery_pause pauses active goal and clears unsafe runtime work", () => {
  const current = activeGoal({ continuationScheduled: true });
  const plan = planGoalTransition(current, {
    kind: "recovery_pause",
    reason: "non-retryable provider error",
    now: 200,
  });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "paused");
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "clearPendingCompletion",
    "clearStaleQueuedWork",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});