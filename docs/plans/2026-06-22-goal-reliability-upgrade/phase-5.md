# Phase 5: Recovery Machine and Status Attention

**Goal:** Add Fitch-style provider/context-overflow recovery so goals pause or block continuation safely when the host/model cannot continue reliably.

**Tasks:** 3 related tasks only.

## References

- Current runtime events: `src/index.ts`, especially `agent_end`, `turn_end`, `input`, `session_compact`, and `session_shutdown`
- Current footer formatting: `src/format.ts`, `src/state.test.ts`
- Current stale-work behavior: `src/stale-queued-work-guard.ts`, `src/runtime.test.ts`
- Fitch recovery implementation: `fitchmultz-pi-codex-goal/src/recovery.ts`, `fitchmultz-pi-codex-goal/src/recovery-machine.ts`, `fitchmultz-pi-codex-goal/src/recovery-runtime.ts`
- Fitch recovery tests: `fitchmultz-pi-codex-goal/test/recovery.test.ts`, `fitchmultz-pi-codex-goal/test/recovery-overflow.test.ts`, `fitchmultz-pi-codex-goal/test/recovery-commands.test.ts`
- Fitch agent-end recovery flow: `fitchmultz-pi-codex-goal/src/goal-runtime-agent-handlers.ts`

### Task 1: Recovery Classification and Machine

**Files:**
- Create: `src/recovery.ts`
- Create: `src/recovery-machine.ts`
- Create: `src/recovery.test.ts`

- [ ] **Step 1: Write failing recovery tests**

Create `src/recovery.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import {
  CONTEXT_OVERFLOW_SIGNATURE,
  failureSignature,
  formatRecoveryAttention,
  isContextOverflowError,
  isErrorAssistantMessage,
  isRetryableTransientError,
} from "./recovery.ts";
import {
  createGoalRecoveryMachine,
  onRecoverySuccessfulTurn,
  onRecoveryUserInput,
  planRecoveryForAssistantError,
  planRecoveryForSilentContextOverflow,
} from "./recovery-machine.ts";

test("detects context overflow and canonicalizes signature", () => {
  assert.equal(isContextOverflowError("context_length_exceeded: prompt too large"), true);
  assert.equal(isContextOverflowError("prompt is too long: 100000 tokens > 128000 maximum"), true);
  assert.equal(failureSignature("prompt is too long: 100000 tokens > 128000 maximum"), CONTEXT_OVERFLOW_SIGNATURE);
});

test("detects error assistant messages", () => {
  assert.equal(isErrorAssistantMessage({ role: "assistant", stopReason: "error" }), true);
  assert.equal(isErrorAssistantMessage({ role: "assistant", stopReason: "end_turn" }), false);
  assert.equal(isErrorAssistantMessage({ role: "user", stopReason: "error" }), false);
});

test("classifies retryable and non-retryable provider errors", () => {
  assert.equal(isRetryableTransientError("websocket closed before message_stop"), true);
  assert.equal(isRetryableTransientError("429 rate limit exceeded"), true);
  assert.equal(isRetryableTransientError("insufficient_quota 429"), false);
  assert.equal(isRetryableTransientError("Monthly usage limit reached"), false);
});

test("first context overflow is noop and repeated overflow pauses", () => {
  const state = createGoalRecoveryMachine();

  const first = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "context_length_exceeded",
  });
  assert.equal(first.type, "noop");
  assert.equal(state.counters.compactionAttempts, 1);

  const second = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "context_length_exceeded",
  });
  assert.equal(second.type, "pause");
  assert.match(second.reason, /context window recovery failed/i);
});

test("retryable transient error sets pending attention", () => {
  const state = createGoalRecoveryMachine();
  const action = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });

  assert.equal(action.type, "pending");
  assert.equal(state.attention?.kind, "pending");
  assert.match(formatRecoveryAttention(state.attention) ?? "", /Goal recovery pending/);
});

test("non-retryable provider error pauses immediately", () => {
  const state = createGoalRecoveryMachine();
  const action = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "insufficient_quota 429",
  });

  assert.equal(action.type, "pause");
  assert.match(action.reason, /non-retryable provider error/i);
});

test("silent context overflow uses same compaction counter", () => {
  const state = createGoalRecoveryMachine();
  assert.equal(planRecoveryForSilentContextOverflow(state).type, "noop");
  assert.equal(planRecoveryForSilentContextOverflow(state).type, "pause");
});

test("successful assistant turn and user input reset recovery", () => {
  const state = createGoalRecoveryMachine();
  planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });
  assert.equal(state.attention?.kind, "pending");

  assert.equal(onRecoverySuccessfulTurn(state, { role: "assistant", stopReason: "end_turn" }), true);
  assert.equal(state.attention, null);

  planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });
  onRecoveryUserInput(state);
  assert.equal(state.attention, null);
  assert.equal(state.counters.signature, null);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/recovery.test.ts`

Expected: FAIL because recovery modules do not exist.

- [ ] **Step 3: Implement `src/recovery.ts`**

Adapt the concepts from `fitchmultz-pi-codex-goal/src/recovery.ts`, but avoid importing `@earendil-works/pi-ai` overflow helpers unless the current installed version exposes a stable function. Use conservative regex detection.

Required exports:

```ts
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
```

Required functions:

- `createErrorRecoveryCounters()`
- `isErrorAssistantMessage(message)`
- `isSuccessfulAssistantTurn(message)`
- `isContextOverflowError(errorMessage)`
- `isRetryableTransientError(errorMessage)`
- `failureSignature(errorMessage)`
- `countersForFailureSignature(counters, signature)`
- `createRecoveryPendingAttention(reason)`
- `createRecoveryPausedAttention(reason)`
- `formatRecoveryAttention(attention)`

Regex requirements:

- Context overflow true for: `context_length_exceeded`, `prompt is too long`, `context window`, `maximum context`, `tokens >`.
- Non-retryable provider limit true for: `GoUsageLimitError`, `FreeUsageLimitError`, `Monthly usage limit reached`, `available balance`, `insufficient_quota`, `out of budget`, `quota exceeded`, `billing`.
- Retryable transient true for: `overloaded`, `rate limit`, `too many requests`, `429`, `500`, `502`, `503`, `504`, `service unavailable`, `network error`, `websocket closed`, `fetch failed`, `timeout`, `stream ended before message_stop`.

- [ ] **Step 4: Implement `src/recovery-machine.ts`**

Adapt from `fitchmultz-pi-codex-goal/src/recovery-machine.ts`.

Required exports:

```ts
export type RecoveryAction =
  | { type: "noop" }
  | { type: "pending"; reason: string }
  | { type: "pause"; reason: string };

export interface GoalRecoveryMachineState {
  counters: ErrorRecoveryCounters;
  attention: RecoveryAttention | null;
  needsUserStartTurn: boolean;
}
```

Required behavior:

- `createGoalRecoveryMachine()` initializes counters, `attention: null`, `needsUserStartTurn: false`.
- `resetRecoveryMachine(state)` clears counters, attention, and user-start gate.
- `onRecoveryUserInput(state)` resets all recovery.
- `onRecoverySuccessfulTurn(state, message)` resets counters/attention when message is successful and returns true; otherwise false.
- `planRecoveryForAssistantError(state, message)`:
  - context overflow increments compaction attempts and returns `noop` until attempts exceed `MAX_CONTEXT_COMPACTION_RETRIES`; then sets paused attention and returns `pause`.
  - non-retryable provider errors set paused attention and return `pause`.
  - retryable transient errors increment transient attempts, set pending attention, and return `pending`.
- `planRecoveryForSilentContextOverflow(state)` uses the same overflow counter.
- `recoveryBlocksContinuation(state)` returns true when `needsUserStartTurn` is true or attention is paused.
- `requireRecoveryUserStart(state)` sets `needsUserStartTurn = true`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/recovery.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/recovery.ts src/recovery-machine.ts src/recovery.test.ts
git commit -m "feat: add goal recovery machine"
```

### Task 2: Format Recovery Attention and Block Continuations

**Files:**
- Modify: `src/format.ts`
- Modify: `src/index.ts`
- Modify: `src/state.test.ts`
- Modify: `src/runtime.test.ts`

- [ ] **Step 1: Write failing formatting test**

In `src/state.test.ts`, import `formatRecoveryAttention` from `src/recovery.ts` or expose footer formatting with an optional attention parameter.

Preferred change: update `formatFooterStatus(goal, recoveryAttention?)` while preserving existing call sites.

Add:

```ts
import { createRecoveryPendingAttention, createRecoveryPausedAttention } from "./recovery.ts";
```

Add tests:

```ts
test("footer status surfaces recovery attention before normal goal status", () => {
  assert.match(
    formatFooterStatus(activeGoal(), createRecoveryPendingAttention("provider error (websocket closed)")) ?? "",
    /Goal recovery pending/,
  );
  assert.match(
    formatFooterStatus(activeGoal({ status: "paused" }), createRecoveryPausedAttention("non-retryable provider error")) ?? "",
    /Goal needs attention/,
  );
});
```

- [ ] **Step 2: Write failing runtime continuation-block test**

Add to `src/runtime.test.ts`:

```ts
test("pending recovery blocks automatic continuation", async () => {
  const scheduled: Function[] = [];
  const pi = fakePi();
  createGoalExtension({ scheduler: (fn) => scheduled.push(fn), clock: () => 100 }).register(pi as never);
  const goal = activeGoal({ goalId: "g" });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.agent_end[0]({
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "websocket closed" }],
  }, ctx);

  assert.equal(scheduled.length, 0);
  assert.match(ctx.statuses["pi-goal"] ?? "", /recovery pending/i);
});
```

- [ ] **Step 3: Run focused tests to verify they fail**

Run:

```bash
npm test -- src/state.test.ts src/runtime.test.ts
```

Expected: FAIL because formatting and runtime recovery state are not integrated.

- [ ] **Step 4: Update `src/format.ts`**

Change signature:

```ts
import { formatRecoveryAttention, type RecoveryAttention } from "./recovery.ts";

export function formatFooterStatus(goal: GoalState | null, recoveryAttention: RecoveryAttention | null = null): string | undefined {
  const recovery = formatRecoveryAttention(recoveryAttention);
  if (recovery) return recovery;
  // existing logic
}
```

Do not remove existing goal status strings.

- [ ] **Step 5: Add recovery state to `src/index.ts`**

Inside `createGoalExtension()`:

```ts
const recoveryState = createGoalRecoveryMachine();
```

Update `refreshStatus(ctx)`:

```ts
ctx.ui.setStatus("pi-goal", statusBarEnabled ? formatFooterStatus(currentGoal, recoveryState.attention) : undefined);
```

Update `shouldScheduleContinuation()` call sites so continuation is blocked when recovery requires it:

```ts
if (recoveryBlocksContinuation(recoveryState)) return false;
```

This can be done by adding `recoveryBlocked?: boolean` to `shouldScheduleContinuation()` options and tests.

- [ ] **Step 6: Handle retryable error on `agent_end`**

In `agent_end`, before `ensurePendingContinuation(pi, ctx)`, inspect `event.messages`:

```ts
const errorMessages = Array.isArray(event.messages)
  ? event.messages.filter(isErrorAssistantMessage)
  : [];
if (errorMessages.length > 0) {
  const lastError = errorMessages.at(-1);
  if (lastError) {
    const action = planRecoveryForAssistantError(recoveryState, lastError);
    if (action.type === "pending") {
      refreshStatus(ctx);
      syncGoalTools(pi);
      return;
    }
    if (action.type === "pause" && currentGoal?.status === "active") {
      // Task 3 will route this through recovery_pause transition.
      currentGoal = transitionGoal(currentGoal, "paused", clock());
      persist(pi, currentGoal, { force: true });
      invalidateContinuation();
      refreshStatus(ctx);
      syncGoalTools(pi);
      ctx.ui.notify(`Goal paused for recovery: ${action.reason}`, "warning");
      return;
    }
  }
}
```

This temporary direct pause is replaced by transition-planned recovery pause in Task 3.

- [ ] **Step 7: Reset recovery on user input and successful turn**

In `input` handler, call `onRecoveryUserInput(recoveryState)` before clearing suppression.

In `agent_end`, after determining there are no error messages and before scheduling continuation, reset recovery on a successful assistant message:

```ts
const lastAssistant = [...event.messages].reverse().find((message) => message.role === "assistant");
if (lastAssistant) onRecoverySuccessfulTurn(recoveryState, lastAssistant);
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
npm test -- src/recovery.test.ts src/state.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/format.ts src/index.ts src/state.test.ts src/runtime.test.ts
git commit -m "feat: surface goal recovery attention"
```

### Task 3: Recovery Pause Through Transition Planner

**Files:**
- Modify: `src/goal-transition.ts`
- Modify: `src/index.ts`
- Modify: `src/goal-transition.test.ts`
- Modify: `src/runtime.test.ts`

- [ ] **Step 1: Add transition test for recovery pause**

Add to `src/goal-transition.test.ts`:

```ts
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
```

- [ ] **Step 2: Add runtime test for non-retryable recovery pause**

Add to `src/runtime.test.ts`:

```ts
test("non-retryable provider error pauses active goal and cancels continuation", async () => {
  const scheduled: Function[] = [];
  const pi = fakePi();
  createGoalExtension({ scheduler: (fn) => scheduled.push(fn), clock: () => 100 }).register(pi as never);
  const goal = activeGoal({ goalId: "g" });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.agent_end[0]({
    messages: [{ role: "assistant", stopReason: "error", errorMessage: "insufficient_quota 429" }],
  }, ctx);

  const latest = pi.entries.at(-1)?.data as any;
  assert.equal(latest.goal.status, "paused");
  assert.match(ctx.statuses["pi-goal"] ?? "", /needs attention/i);
  assert.equal(scheduled.length, 0);
});
```

- [ ] **Step 3: Run focused tests to verify they fail if transition is incomplete**

Run:

```bash
npm test -- src/goal-transition.test.ts src/runtime.test.ts
```

Expected: FAIL if recovery pause still emits different effects or bypasses transition planning.

- [ ] **Step 4: Route recovery pause through transition effects**

Replace the temporary direct pause in `src/index.ts` from Task 2 with:

```ts
const plan = planGoalTransition(currentGoal, {
  kind: "recovery_pause",
  reason: action.reason,
  now: clock(),
});
applyTransitionEffects(plan.effects, ctx);
if (plan.nextGoal) persist(pi, plan.nextGoal, { force: true });
ctx.ui.notify(`Goal paused for recovery: ${action.reason}`, "warning");
return;
```

Update `resetRecovery` effect handler carefully:

- For ordinary clear/replace/resume/complete effects, it should call `resetRecoveryMachine(recoveryState)`.
- For recovery pause itself, do not erase the paused attention that was just set by `planRecoveryForAssistantError()`.

If the single `resetRecovery` effect cannot distinguish this safely, do not include `resetRecovery` in `recovery_pause` effects.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/recovery.test.ts src/goal-transition.test.ts src/runtime.test.ts
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
git add src/recovery.ts src/recovery-machine.ts src/goal-transition.ts src/index.ts src/recovery.test.ts src/goal-transition.test.ts src/runtime.test.ts
git commit -m "feat: pause goals for recovery failures"
```

## Phase Verification

- [ ] Recovery unit tests pass: `npm test -- src/recovery.test.ts`
- [ ] Transition tests pass: `npm test -- src/goal-transition.test.ts`
- [ ] Runtime recovery tests pass: `npm test -- src/runtime.test.ts`
- [ ] Full tests pass: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Stop for human review if current Pi event payloads do not expose assistant `errorMessage`/`stopReason` fields needed for recovery classification
