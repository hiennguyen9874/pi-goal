# Phase 3: Transition Planner and Effects Seam

**Goal:** Centralize lifecycle decisions behind a transition planner and explicit effects so command/tool paths cannot drift and future recovery/persistence changes have a safe seam.

**Tasks:** 3 related tasks only.

## References

- Current lifecycle logic: `src/state.ts`, `src/index.ts`, `src/commands.ts`, `src/tools.ts`
- Current runtime tests: `src/runtime.test.ts`, `src/commands-tools.test.ts`
- Design transition requirements: `docs/plans/2026-06-22-goal-reliability-upgrade/design.md`
- Fitch transition reference: `fitchmultz-pi-codex-goal/src/goal-transition.ts`
- Fitch transition effects reference: `fitchmultz-pi-codex-goal/src/goal-transition-effects.ts`
- Fitch transition tests reference: `fitchmultz-pi-codex-goal/test/goal-transition.test.ts`

### Task 1: Pure Transition Planner

**Files:**
- Create: `src/goal-transition.ts`
- Create: `src/goal-transition.test.ts`
- Modify: `src/state.ts`

- [ ] **Step 1: Write failing transition planner tests**

Create `src/goal-transition.test.ts`. Use the current `GoalState` shape and status spelling, not Fitch's `ThreadGoal` or `budgetLimited` spelling.

```ts
import test from "node:test";
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

test("pause active goal persists set and clears continuation/accounting", () => {
  const current = activeGoal({ continuationScheduled: true });
  const plan = planGoalTransition(current, { kind: "pause", now: 200 });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "paused");
  assert.equal(plan.nextGoal?.continuationScheduled, false);
  assert.deepEqual(effectTypes(plan.effects), [
    "clearContinuation",
    "clearActiveAccounting",
    "clearBudgetWarning",
    "syncTools",
    "refreshUi",
  ]);
});

test("resume paused goal clears suppression and queues continuation effect", () => {
  const current = activeGoal({ status: "paused", continuationSuppressed: true, lastContinuationHadToolCall: false });
  const plan = planGoalTransition(current, { kind: "resume", now: 200 });

  assert.equal(plan.persist, "set");
  assert.equal(plan.nextGoal?.status, "active");
  assert.equal(plan.nextGoal?.continuationSuppressed, false);
  assert.equal(plan.nextGoal?.lastContinuationHadToolCall, true);
  assert.deepEqual(effectTypes(plan.effects), [
    "resetRecovery",
    "clearBudgetWarning",
    "markContinuationQueued",
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
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/goal-transition.test.ts`

Expected: FAIL because `src/goal-transition.ts` does not exist.

- [ ] **Step 3: Implement `src/goal-transition.ts`**

Create these exported types:

```ts
import { transitionGoal, type GoalState } from "./state.ts";

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
```

Implementation rules:

- Use a local `pushEffectOnce()` helper so duplicate effects are not emitted.
- `create_or_replace`:
  - `persist: "set"` unless current and next are equivalent.
  - If goal ID changes, effects are exactly the list in the test.
  - If new goal is active, include `markContinuationQueued` only in Phase 6 when scheduling is fully effect-driven; for this phase, do not include it for replacement unless the test requires it.
- `pause`: derive via `transitionGoal(current, "paused", now)` and throw if current is missing or not active.
- `resume`: derive via `transitionGoal(current, "active", now)` and throw if current is missing or not paused.
- `clear`: `nextGoal: null`, `persist: "clear"`, effects include continuation/accounting/pending completion/stale/recovery/budget/tool/UI cleanup.
- `complete`: derive via `transitionGoal(current, "complete", now)` and throw if current is missing or not active.
- `recovery_pause`: derive paused goal from active current and include `resetRecovery` only after attention has been persisted by the recovery subsystem in Phase 5.
- `runtime_accounting`: validate invariants and return `persist: "usage"`.

Invariant error messages must include the phrases used by tests: `goalId mismatch`, `tokensUsed must not decrease`, and `at or above tokenBudget`.

- [ ] **Step 4: Export helper if needed from `src/state.ts`**

If `goal-transition.ts` needs `isTerminalGoalStatus` or `goalsEquivalent`, reuse existing exports. Do not add duplicate lifecycle helpers.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/goal-transition.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/goal-transition.ts src/goal-transition.test.ts src/state.ts
git commit -m "feat: add goal transition planner"
```

### Task 2: Transition Effects Adapter

**Files:**
- Create: `src/goal-transition-effects.ts`
- Create: `src/goal-transition-effects.test.ts`
- Modify: `src/goal-transition.ts`

- [ ] **Step 1: Write failing effect adapter tests**

Create `src/goal-transition-effects.test.ts`:

```ts
import test from "node:test";
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
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/goal-transition-effects.test.ts`

Expected: FAIL because adapter does not exist.

- [ ] **Step 3: Implement adapter**

Create `src/goal-transition-effects.ts`:

```ts
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
```

This mirrors the concept in `fitchmultz-pi-codex-goal/src/goal-transition-effects.ts` but keeps the current project's smaller single-effect-list design.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/goal-transition-effects.test.ts src/goal-transition.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/goal-transition-effects.ts src/goal-transition-effects.test.ts src/goal-transition.ts
git commit -m "feat: add goal transition effects adapter"
```

### Task 3: Route Command and Tool Lifecycle Through Transition Planner

**Files:**
- Modify: `src/index.ts`
- Modify: `src/runtime.test.ts`
- Modify: `src/commands-tools.test.ts`

- [ ] **Step 1: Add runtime regression tests for shared effects**

Add tests to `src/runtime.test.ts`:

```ts
test("/goal replacement and tool replacement both cancel pending old continuation", async () => {
  const scheduled: Function[] = [];
  const pi = fakePi();
  createGoalExtension({ scheduler: (fn) => scheduled.push(fn), clock: () => 100 }).register(pi as never);
  const goal = activeGoal({ goalId: "old-goal" });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.agent_end[0]({ messages: [] }, ctx);
  assert.equal(scheduled.length, 1);

  await pi.commands.goal.handler("Replacement", ctx);
  scheduled[0]();
  assert.equal(pi.messages.some((entry) => entry.message.details?.goalId === "old-goal"), false);

  await pi.handlers.agent_end[0]({ messages: [] }, ctx);
  const secondScheduled = scheduled.at(-1);
  assert.ok(secondScheduled);
  await pi.tools.create_goal.execute("tool-1", { objective: "Tool replacement", replace_existing: true }, undefined, undefined, ctx);
  secondScheduled();
  assert.equal(pi.messages.some((entry) => entry.message.details?.goalId === "old-goal"), false);
});
```

If this overlaps with the Phase 2 replacement test, keep the more comprehensive version and delete the narrower duplicate.

- [ ] **Step 2: Run focused runtime tests**

Run: `npm test -- src/runtime.test.ts`

Expected: PASS before refactor and after refactor. This is a safety net for no behavior drift.

- [ ] **Step 3: Refactor `src/index.ts` lifecycle paths**

Import:

```ts
import { planGoalTransition } from "./goal-transition.ts";
import { applyGoalTransitionEffects } from "./goal-transition-effects.ts";
```

Add a local helper inside `createGoalExtension()`:

```ts
function applyTransitionEffects(effects: GoalTransitionEffect[], ctx: ExtensionContext): void {
  applyGoalTransitionEffects(effects, {
    clearContinuation: invalidateContinuation,
    clearActiveAccounting,
    clearPendingCompletion: () => { pendingCompletionGoalId = null; },
    clearStaleQueuedWork: () => {
      staleQueuedWorkGuard.clear();
      currentTurnQueuedGoalId = null;
      currentTurnIsStaleQueuedWork = false;
    },
    resetRecovery: () => {},
    clearBudgetWarning: () => {},
    markContinuationQueued: () => {},
    syncTools: () => syncGoalTools(pi),
    refreshUi: () => refreshStatus(ctx),
  });
}
```

In Phase 3, `resetRecovery`, `clearBudgetWarning`, and `markContinuationQueued` can be no-ops because recovery and budget-warning state are not extracted yet. Phase 5 and Phase 6 will replace those with real handlers.

Route these paths through `planGoalTransition()`:

- command `setGoal()` for create/replace/pause/resume
- tool `setGoal()` for create/replace
- command `clearGoal()`
- tool completion path where possible without breaking final-turn accounting

Keep current `persist()`, `clear()`, `emitGoalEvent()`, `scheduleContinuation()`, and initial prompt behavior. This phase changes how decisions are planned, not how messages are delivered.

Required ordering:

1. Plan transition from `currentGoal`.
2. Apply memory-clearing effects that must happen before persistence.
3. Persist or clear according to `plan.persist`.
4. Sync tools and refresh UI via effects.
5. Preserve existing event emission and prompt scheduling logic.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- src/goal-transition.test.ts src/goal-transition-effects.test.ts src/commands-tools.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run full tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/runtime.test.ts src/commands-tools.test.ts
git commit -m "refactor: route goal lifecycle through transitions"
```

## Phase Verification

- [ ] Transition tests pass: `npm test -- src/goal-transition.test.ts`
- [ ] Effect adapter tests pass: `npm test -- src/goal-transition-effects.test.ts`
- [ ] Runtime lifecycle tests pass: `npm test -- src/runtime.test.ts`
- [ ] Command/tool tests pass: `npm test -- src/commands-tools.test.ts`
- [ ] Full tests pass: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Stop for human review if transition effects force a visible behavior change in goal creation, resume, completion, or budget-limit prompts
