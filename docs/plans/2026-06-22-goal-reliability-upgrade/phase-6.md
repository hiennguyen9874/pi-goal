# Phase 6: Runtime Integration Cleanup

**Goal:** Reduce `src/index.ts` orchestration complexity by moving runtime-only state and accounting behavior into focused modules after the transition, persistence, and recovery seams exist.

**Tasks:** 3 related tasks only.

## References

- Current orchestrator: `src/index.ts`
- Current token extraction: `extractTokenUsage()` in `src/index.ts`
- Current runtime tests and fake harness: `src/runtime.test.ts`
- Fitch controller decomposition reference: `fitchmultz-pi-codex-goal/src/goal-runtime-controller.ts`
- Fitch runtime state reference: `fitchmultz-pi-codex-goal/src/goal-runtime-state.ts`
- Fitch accounting reference: `fitchmultz-pi-codex-goal/src/goal-accounting.ts`
- Keep current compact-module target from design; do not copy Fitch's full runtime split.

### Task 1: Runtime State Module

**Files:**
- Create: `src/runtime-state.ts`
- Create: `src/runtime-state.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing runtime-state tests**

Create `src/runtime-state.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createGoalRuntimeState } from "./runtime-state.ts";

test("runtime state initializes all mutable runtime slots", () => {
  const state = createGoalRuntimeState();

  assert.equal(state.awaitingContinuationGoalId, null);
  assert.equal(state.continuationGeneration, 0);
  assert.equal(state.pendingContinuationGoalId, null);
  assert.equal(state.pendingContinuationMessage, null);
  assert.equal(state.activeTurnStartedAt, null);
  assert.equal(state.currentTurnHadToolCall, false);
  assert.equal(state.currentTurnIsContinuation, false);
  assert.equal(state.pendingCompletionGoalId, null);
  assert.equal(state.toolsRestricted, false);
  assert.equal(state.currentTurnQueuedGoalId, null);
  assert.equal(state.currentTurnIsStaleQueuedWork, false);
  assert.equal(state.budgetWarningSentForGoalId, null);
  assert.equal(state.recovery.attention, null);
});

test("clearActiveTurnAccounting resets per-turn accounting fields", () => {
  const state = createGoalRuntimeState();
  state.activeTurnStartedAt = 100;
  state.currentTurnHadToolCall = true;
  state.currentTurnIsContinuation = true;

  state.clearActiveTurnAccounting();

  assert.equal(state.activeTurnStartedAt, null);
  assert.equal(state.currentTurnHadToolCall, false);
  assert.equal(state.currentTurnIsContinuation, false);
});

test("clearQueuedTurnState resets stale queued work markers", () => {
  const state = createGoalRuntimeState();
  state.currentTurnQueuedGoalId = "g";
  state.currentTurnIsStaleQueuedWork = true;

  state.clearQueuedTurnState();

  assert.equal(state.currentTurnQueuedGoalId, null);
  assert.equal(state.currentTurnIsStaleQueuedWork, false);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/runtime-state.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement `src/runtime-state.ts`**

Create a small state factory. Keep it intentionally plain; no class is needed.

```ts
import { createGoalRecoveryMachine, type GoalRecoveryMachineState } from "./recovery-machine.ts";

export interface GoalRuntimeState {
  awaitingContinuationGoalId: string | null;
  continuationGeneration: number;
  pendingContinuationGoalId: string | null;
  pendingContinuationMessage: string | null;
  pendingContinuationGeneration: number;
  activeTurnStartedAt: number | null;
  currentTurnHadToolCall: boolean;
  currentTurnIsContinuation: boolean;
  pendingCompletionGoalId: string | null;
  toolsRestricted: boolean;
  currentTurnQueuedGoalId: string | null;
  currentTurnIsStaleQueuedWork: boolean;
  budgetWarningSentForGoalId: string | null;
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
    activeTurnStartedAt: null,
    currentTurnHadToolCall: false,
    currentTurnIsContinuation: false,
    pendingCompletionGoalId: null,
    toolsRestricted: false,
    currentTurnQueuedGoalId: null,
    currentTurnIsStaleQueuedWork: false,
    budgetWarningSentForGoalId: null,
    recovery: createGoalRecoveryMachine(),
    clearActiveTurnAccounting() {
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
```

- [ ] **Step 4: Integrate into `src/index.ts`**

Replace closure variables with `const runtimeState = createGoalRuntimeState();` and update references incrementally:

- `awaitingContinuationGoalId` → `runtimeState.awaitingContinuationGoalId`
- `pendingContinuationGoalId` → `runtimeState.pendingContinuationGoalId`
- `pendingContinuationMessage` → `runtimeState.pendingContinuationMessage`
- `activeTurnStartedAt` → `runtimeState.activeTurnStartedAt`
- `currentTurnHadToolCall` → `runtimeState.currentTurnHadToolCall`
- `currentTurnIsContinuation` → `runtimeState.currentTurnIsContinuation`
- `pendingCompletionGoalId` → `runtimeState.pendingCompletionGoalId`
- `toolsRestricted` → `runtimeState.toolsRestricted`
- stale turn markers → `runtimeState.currentTurnQueuedGoalId` and `runtimeState.currentTurnIsStaleQueuedWork`
- recovery state → `runtimeState.recovery`

Keep local helper names like `clearActiveTurnAccounting()` if that makes the diff easier, but make them delegate to `runtimeState.clearActiveTurnAccounting()`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/runtime-state.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime-state.ts src/runtime-state.test.ts src/index.ts
git commit -m "refactor: extract goal runtime state"
```

### Task 2: Goal Accounting Module

**Files:**
- Create: `src/goal-accounting.ts`
- Create: `src/goal-accounting.test.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write failing accounting tests**

Create `src/goal-accounting.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { extractTokenUsage, buildGoalUsageDelta } from "./goal-accounting.ts";

test("extractTokenUsage handles total token fields first", () => {
  assert.equal(extractTokenUsage({ usage: { totalTokens: 42, input: 10, output: 10 } }), 42);
  assert.equal(extractTokenUsage({ metadata: { usage: { total: 7 } } }), 7);
});

test("extractTokenUsage sums known token fields", () => {
  assert.equal(extractTokenUsage({ usage: { input: 10, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 } }), 24);
  assert.equal(extractTokenUsage({ tokens: { promptTokens: 6, completionTokens: 7, reasoningTokens: 8 } }), 21);
});

test("buildGoalUsageDelta computes non-negative elapsed seconds", () => {
  assert.deepEqual(buildGoalUsageDelta({
    message: { usage: { totalTokens: 10 } },
    turnStartedAt: 1000,
    now: 4500,
    hadToolCall: true,
    wasContinuation: false,
  }), {
    tokensDelta: 10,
    secondsDelta: 3,
    hadToolCall: true,
    wasContinuation: false,
    now: 4500,
  });

  assert.equal(buildGoalUsageDelta({
    message: undefined,
    turnStartedAt: null,
    now: 4500,
    hadToolCall: false,
    wasContinuation: true,
  }).secondsDelta, 0);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/goal-accounting.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Move accounting helpers into `src/goal-accounting.ts`**

Move `UsageCarrier`, `numberFrom()`, and `extractTokenUsage()` out of `src/index.ts` into `src/goal-accounting.ts`.

Add:

```ts
import type { UsageDelta } from "./state.ts";

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
```

Keep `extractTokenUsage` exported from `src/index.ts` if tests or external consumers import it there:

```ts
export { extractTokenUsage } from "./goal-accounting.ts";
```

- [ ] **Step 4: Update `src/index.ts` turn_end accounting**

Replace inline elapsed/token calculation with:

```ts
const now = clock();
const result = applyGoalUsage(currentGoal, buildGoalUsageDelta({
  message: event.message as UsageCarrier | undefined,
  turnStartedAt: runtimeState.activeTurnStartedAt,
  now,
  hadToolCall: runtimeState.currentTurnHadToolCall,
  wasContinuation: runtimeState.currentTurnIsContinuation,
}));
```

Use the `now` variable consistently to avoid multiple clock reads causing subtle timestamp test failures.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/goal-accounting.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/goal-accounting.ts src/goal-accounting.test.ts src/index.ts
git commit -m "refactor: extract goal accounting helpers"
```

### Task 3: Simplify Orchestrator Without Behavior Drift

**Files:**
- Modify: `src/index.ts`
- Modify: `src/runtime.test.ts`
- Modify: `src/goal-transition-effects.ts`

- [ ] **Step 1: Add high-level regression tests for behavior that must not drift**

Check `src/runtime.test.ts` already covers:

- default export registration
- initial prompt on `/goal`
- hidden continuation scheduling
- no-progress suppression
- stale queued work abort
- budget-limit steer
- final-turn completion accounting
- session reload auto-pause
- context rewriting

If any of those are not covered after earlier edits, add focused tests before refactoring. Add one explicit integration test for recovery reset through resume:

```ts
test("/goal resume clears recovery attention and allows continuation", async () => {
  const scheduled: Function[] = [];
  const pi = fakePi();
  createGoalExtension({ scheduler: (fn) => scheduled.push(fn), clock: () => 100 }).register(pi as never);
  const goal = activeGoal({ goalId: "g" });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.agent_end[0]({
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "insufficient_quota 429" }],
  }, ctx);
  assert.match(ctx.statuses["pi-goal"] ?? "", /needs attention/i);

  await pi.commands.goal.handler("resume", ctx);
  await pi.handlers.agent_end[0]({ messages: [] }, ctx);

  assert.equal(scheduled.length > 0, true);
  assert.doesNotMatch(ctx.statuses["pi-goal"] ?? "", /needs attention/i);
});
```

- [ ] **Step 2: Run focused runtime tests before refactor**

Run: `npm test -- src/runtime.test.ts`

Expected: PASS.

- [ ] **Step 3: Consolidate effect handlers in `src/index.ts`**

Create one `transitionEffectHandlers(ctx)` local helper returning `GoalTransitionEffectHandlers` and use it for every `applyGoalTransitionEffects()` call.

Required real handlers after Phase 6:

- `clearContinuation`: clears pending continuation slots and increments generations without incorrectly wiping current goal state.
- `clearActiveAccounting`: delegates to `runtimeState.clearActiveTurnAccounting()`.
- `clearPendingCompletion`: sets `runtimeState.pendingCompletionGoalId = null`.
- `clearStaleQueuedWork`: clears stale guard and queued turn markers.
- `resetRecovery`: calls `resetRecoveryMachine(runtimeState.recovery)`.
- `clearBudgetWarning`: sets `runtimeState.budgetWarningSentForGoalId = null`.
- `markContinuationQueued`: schedules continuation for the provided active goal only when current idle/pending-message checks pass.
- `syncTools`: calls `syncGoalTools(pi)`.
- `refreshUi`: calls `refreshStatus(ctx)`.

If `markContinuationQueued` cannot safely call `scheduleContinuation()` without recursion in this phase, leave it as a no-op and keep existing explicit scheduling for resume/create. Document that decision in a code comment next to the handler:

```ts
// Continuation scheduling remains explicit at command/runtime call sites so the effect stays side-effect-safe.
```

- [ ] **Step 4: Reduce `src/index.ts` direct mutation sites**

Search:

```bash
grep -n "currentGoal =\|runtimeState\..*=\|pendingContinuation\|pendingCompletion" src/index.ts
```

Allowed direct mutation sites after cleanup:

- Persistence snapshot assignment through `goal-persistence.ts` methods.
- Runtime state helper functions (`invalidateContinuation`, `clearActiveTurnAccounting`, `schedulePendingContinuation`).
- Event handlers setting observed event facts (`turn_start`, `tool_execution_end`, `before_agent_start`).

Lifecycle changes should use `planGoalTransition()`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/runtime-state.test.ts src/goal-accounting.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full validation**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/runtime.test.ts src/goal-transition-effects.ts
git commit -m "refactor: simplify goal runtime orchestration"
```

## Phase Verification

- [ ] Runtime state tests pass: `npm test -- src/runtime-state.test.ts`
- [ ] Accounting tests pass: `npm test -- src/goal-accounting.test.ts`
- [ ] Runtime integration tests pass: `npm test -- src/runtime.test.ts`
- [ ] Full tests pass: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Stop for human review if `src/index.ts` refactor changes any visible prompt, notification, status, or continuation scheduling behavior unexpectedly
