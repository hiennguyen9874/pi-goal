# Phase 4: Runtime Usage Persistence and Replay Hardening

**Goal:** Extend session-journal persistence with replay-safe runtime `usage` entries so routine accounting does not require full goal snapshots and stale/out-of-order entries cannot corrupt restored goal state.

**Tasks:** 3 related tasks only.

## References

- Current state persistence: `src/state.ts`, `src/index.ts`, `src/state.test.ts`, `src/runtime.test.ts`
- Design persistence rules: `docs/plans/2026-06-22-goal-reliability-upgrade/design.md`
- Fitch persistence reference: `fitchmultz-pi-codex-goal/src/goal-persistence.ts`
- Fitch state/replay reference: `fitchmultz-pi-codex-goal/src/state.ts`
- Fitch persistence tests reference: `fitchmultz-pi-codex-goal/test/persistence.test.ts`

### Task 1: State Entry Model and Replay Rules

**Files:**
- Modify: `src/state.ts`
- Modify: `src/state.test.ts`

- [ ] **Step 1: Write failing state tests for usage entries**

Add these tests to `src/state.test.ts`:

```ts
import { runtimeUsageEntry } from "./state.ts";
```

If imports are already grouped, add `runtimeUsageEntry` to the existing import list.

Add tests:

```ts
test("runtime usage entries update matching active goals during reconstruction", () => {
  const goal = activeGoal({ goalId: "g", tokenBudget: 100, updatedAt: 1000 });
  const reconstructed = reconstructGoal([
    { type: "custom", customType: ENTRY_TYPE, data: goalEntry(goal, 1000) },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "g",
        status: "active",
        tokensUsed: 30,
        timeUsedSeconds: 12,
        turnCount: 2,
        continuationCount: 1,
        updatedAt: 2000,
      }, 2000),
    },
  ]);

  assert.equal(reconstructed?.goalId, "g");
  assert.equal(reconstructed?.tokensUsed, 30);
  assert.equal(reconstructed?.timeUsedSeconds, 12);
  assert.equal(reconstructed?.turnCount, 2);
  assert.equal(reconstructed?.continuationCount, 1);
  assert.equal(reconstructed?.updatedAt, 2000);
});

test("runtime usage entries ignore mismatched goal ids", () => {
  const goal = activeGoal({ goalId: "g", tokensUsed: 10, updatedAt: 1000 });
  const reconstructed = reconstructGoal([
    { type: "custom", customType: ENTRY_TYPE, data: goalEntry(goal, 1000) },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "other",
        status: "active",
        tokensUsed: 50,
        timeUsedSeconds: 50,
        turnCount: 5,
        continuationCount: 5,
        updatedAt: 2000,
      }, 2000),
    },
  ]);

  assert.equal(reconstructed?.tokensUsed, 10);
  assert.equal(reconstructed?.updatedAt, 1000);
});

test("runtime usage entries ignore decreasing usage or updatedAt rewind", () => {
  const goal = activeGoal({ goalId: "g", tokensUsed: 20, timeUsedSeconds: 10, turnCount: 3, updatedAt: 1000 });
  const reconstructed = reconstructGoal([
    { type: "custom", customType: ENTRY_TYPE, data: goalEntry(goal, 1000) },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "g",
        status: "active",
        tokensUsed: 19,
        timeUsedSeconds: 11,
        turnCount: 4,
        continuationCount: 0,
        updatedAt: 2000,
      }, 2000),
    },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "g",
        status: "active",
        tokensUsed: 21,
        timeUsedSeconds: 11,
        turnCount: 4,
        continuationCount: 0,
        updatedAt: 999,
      }, 2001),
    },
  ]);

  assert.equal(reconstructed?.tokensUsed, 20);
  assert.equal(reconstructed?.updatedAt, 1000);
});

test("budget_limited runtime usage requires usage at or over budget", () => {
  const goal = activeGoal({ goalId: "g", tokenBudget: 100, tokensUsed: 80, updatedAt: 1000 });
  const reconstructed = reconstructGoal([
    { type: "custom", customType: ENTRY_TYPE, data: goalEntry(goal, 1000) },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "g",
        status: "budget_limited",
        tokensUsed: 99,
        timeUsedSeconds: 20,
        turnCount: 2,
        continuationCount: 1,
        updatedAt: 2000,
      }, 2000),
    },
    {
      type: "custom",
      customType: ENTRY_TYPE,
      data: runtimeUsageEntry({
        goalId: "g",
        status: "budget_limited",
        tokensUsed: 120,
        timeUsedSeconds: 30,
        turnCount: 3,
        continuationCount: 1,
        updatedAt: 3000,
      }, 3000),
    },
  ]);

  assert.equal(reconstructed?.status, "budget_limited");
  assert.equal(reconstructed?.tokensUsed, 120);
  assert.equal(reconstructed?.updatedAt, 3000);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/state.test.ts`

Expected: FAIL because `runtimeUsageEntry` and `usage` replay do not exist.

- [ ] **Step 3: Extend entry types in `src/state.ts`**

Add:

```ts
export interface GoalUsageEntry {
  version: 1;
  action: "usage";
  goalId: string;
  status: Extract<GoalStatus, "active" | "budget_limited">;
  tokensUsed: number;
  timeUsedSeconds: number;
  turnCount: number;
  continuationCount: number;
  updatedAt: number;
  statusBarEnabled?: boolean;
  at: number;
}
```

Change `GoalEntry` to a union:

```ts
export type GoalEntry = GoalSetEntry | GoalClearEntry | GoalUsageEntry;
```

Where `GoalSetEntry` and `GoalClearEntry` preserve the existing `set` and `clear` shapes.

Add helper:

```ts
export type RuntimeUsageSnapshot = Pick<GoalUsageEntry,
  "goalId" | "status" | "tokensUsed" | "timeUsedSeconds" | "turnCount" | "continuationCount" | "updatedAt"
>;

export function runtimeUsageEntry(
  usage: RuntimeUsageSnapshot,
  at = nowMs(),
  statusBarEnabled?: boolean,
): GoalUsageEntry {
  return { version: 1, action: "usage", ...usage, statusBarEnabled, at };
}
```

- [ ] **Step 4: Implement replay guards**

Add a pure helper inside `src/state.ts`:

```ts
function canApplyRuntimeUsageEntry(goal: GoalState, entry: GoalUsageEntry): boolean {
  if (goal.goalId !== entry.goalId) return false;
  if (goal.status !== "active" && goal.status !== "budget_limited") return false;
  if (entry.status !== "active" && entry.status !== "budget_limited") return false;
  if (entry.tokensUsed < goal.tokensUsed) return false;
  if (entry.timeUsedSeconds < goal.timeUsedSeconds) return false;
  if (entry.turnCount < goal.turnCount) return false;
  if (entry.continuationCount < goal.continuationCount) return false;
  if (entry.updatedAt < goal.updatedAt) return false;
  if (entry.status === "budget_limited") {
    if (goal.tokenBudget === null) return false;
    if (entry.tokensUsed < goal.tokenBudget) return false;
  }
  return true;
}
```

Update `reconstructGoal()`:

```ts
if (entry.data.action === "usage") {
  if (current && canApplyRuntimeUsageEntry(current, entry.data)) {
    current = {
      ...current,
      status: entry.data.status,
      tokensUsed: entry.data.tokensUsed,
      timeUsedSeconds: entry.data.timeUsedSeconds,
      turnCount: entry.data.turnCount,
      continuationCount: entry.data.continuationCount,
      updatedAt: entry.data.updatedAt,
    };
  }
  continue;
}
```

Keep malformed entries skipped via `isGoalEntry()`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/state.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/state.ts src/state.test.ts
git commit -m "feat: replay runtime goal usage entries"
```

### Task 2: Goal Persistence Module

**Files:**
- Create: `src/goal-persistence.ts`
- Create: `src/goal-persistence.test.ts`
- Modify: `src/state.ts`

- [ ] **Step 1: Write failing persistence module tests**

Create `src/goal-persistence.test.ts`:

```ts
import test from "node:test";
import assert from "node:assert/strict";

import { createGoalPersistence } from "./goal-persistence.ts";
import { ENTRY_TYPE, createGoal, type GoalEntry } from "./state.ts";

test("runtime persistence writes usage entry when static goal fields match", () => {
  const entries: Array<{ customType: string; data: GoalEntry }> = [];
  const persistence = createGoalPersistence({
    appendEntry(customType, data) { entries.push({ customType, data: data as GoalEntry }); },
    clock: () => 1000,
    statusBarEnabled: () => true,
  });

  const goal = createGoal("Ship", 100, { goalId: "g", now: 1 });
  persistence.setCurrentGoal(goal);
  persistence.persistCurrent("set", { force: true });

  persistence.setCurrentGoal({ ...goal, tokensUsed: 10, timeUsedSeconds: 2, turnCount: 1, updatedAt: 2000 });
  persistence.persistCurrent("runtime", { force: true });

  assert.equal(entries[0]?.customType, ENTRY_TYPE);
  assert.equal(entries[0]?.data.action, "set");
  assert.equal(entries[1]?.data.action, "usage");
  assert.equal(entries[1]?.data.goalId, "g");
});

test("runtime persistence falls back to set when static fields changed", () => {
  const entries: Array<{ customType: string; data: GoalEntry }> = [];
  const persistence = createGoalPersistence({
    appendEntry(customType, data) { entries.push({ customType, data: data as GoalEntry }); },
    clock: () => 1000,
    statusBarEnabled: () => true,
  });

  const goal = createGoal("Ship", 100, { goalId: "g", now: 1 });
  persistence.setCurrentGoal(goal);
  persistence.persistCurrent("set", { force: true });

  persistence.setCurrentGoal({ ...goal, objective: "Changed", tokensUsed: 10, updatedAt: 2000 });
  persistence.persistCurrent("runtime", { force: true });

  assert.equal(entries[1]?.data.action, "set");
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/goal-persistence.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement `src/goal-persistence.ts`**

Use `fitchmultz-pi-codex-goal/src/goal-persistence.ts` as the reference, adapted to current `GoalState` fields.

Required exported factory:

```ts
import {
  ENTRY_TYPE,
  cloneGoal,
  goalEntry,
  clearGoalEntry,
  goalsEquivalent,
  runtimeUsageEntry,
  type GoalState,
} from "./state.ts";

export interface GoalPersistenceDeps {
  appendEntry(customType: string, data: unknown): void;
  clock(): number;
  statusBarEnabled(): boolean;
}

export type GoalPersistenceSource = "set" | "runtime" | "clear";

export function createGoalPersistence(deps: GoalPersistenceDeps) { /* ... */ }
```

Required methods:

```ts
getCurrentGoal(): GoalState | null;
setCurrentGoal(goal: GoalState | null): void;
syncPersistedSnapshot(goal: GoalState | null): void;
persistCurrent(source: "set" | "runtime", options?: { force?: boolean }): boolean;
appendClearEntry(clearedGoalId: string | null): void;
getLastRuntimePersistAt(): number | null;
```

Runtime usage entry is safe only when last persisted snapshot exists and these fields match:

- `goalId`
- `objective`
- `tokenBudget`
- `createdAt`

Runtime usage entry is allowed only when current and last statuses are `active` or `budget_limited`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- src/goal-persistence.test.ts src/state.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/goal-persistence.ts src/goal-persistence.test.ts src/state.ts
git commit -m "feat: add goal persistence module"
```

### Task 3: Integrate Runtime Usage Persistence

**Files:**
- Modify: `src/index.ts`
- Modify: `src/runtime.test.ts`
- Modify: `src/goal-transition.ts`

- [ ] **Step 1: Update runtime tests to expect usage entries**

Modify `turn_end accounts elapsed seconds and usage tokens` in `src/runtime.test.ts` so it accepts the latest entry as either set or usage where appropriate, then add a specific new test:

```ts
test("turn_end persists runtime accounting as usage entry after initial set", async () => {
  const pi = fakePi();
  let time = 1000;
  createGoalExtension({ clock: () => time }).register(pi as never);
  const goal = activeGoal({ tokenBudget: 1000 });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.turn_start[0]({ timestamp: 1000 }, ctx);
  time = 4000;
  await pi.handlers.turn_end[0]({ message: { role: "assistant", usage: { input: 10, output: 15 } } }, ctx);

  const latest = pi.entries.at(-1)?.data as any;
  assert.equal(latest.action, "usage");
  assert.equal(latest.goalId, "goal-1");
  assert.equal(latest.tokensUsed, 25);
  assert.equal(latest.timeUsedSeconds, 3);
  assert.equal(latest.turnCount, 1);
});
```

Add another test:

```ts
test("completion still persists full complete set after final turn accounting", async () => {
  const pi = fakePi();
  let time = 1000;
  createGoalExtension({ clock: () => time }).register(pi as never);
  const goal = activeGoal({ goalId: "g", tokenBudget: 1000 });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.turn_start[0]({}, ctx);
  await pi.tools.update_goal.execute("tool-1", { status: "complete" }, undefined, undefined, ctx);
  time = 2000;
  await pi.handlers.turn_end[0]({ message: { role: "assistant", usage: { totalTokens: 20 } } }, ctx);

  const latest = pi.entries.at(-1)?.data as any;
  assert.equal(latest.action, "set");
  assert.equal(latest.goal.status, "complete");
  assert.equal(latest.goal.tokensUsed, 20);
});
```

- [ ] **Step 2: Run focused runtime tests to verify they fail**

Run: `npm test -- src/runtime.test.ts`

Expected: FAIL because runtime accounting still persists full `set` snapshots.

- [ ] **Step 3: Integrate `createGoalPersistence()` in `src/index.ts`**

Replace local persistence fields where practical:

Current closure fields to remove or delegate:

- `currentGoal`
- `lastPersistedGoal`
- `lastRuntimePersistAt`

Keep getter compatibility:

```ts
return { register, scheduleContinuation, get currentGoal() { return persistence.getCurrentGoal(); } };
```

Local helper adjustments:

- `persist(pi, goal, { force })` becomes:
  1. `persistence.setCurrentGoal(goal)`
  2. `persistence.persistCurrent("set", { force })`
- Runtime accounting persistence uses `persistence.persistCurrent("runtime", { force: isCompleting || result.crossedBudget })`, but force-complete must still persist a full `set` after transitioning to `complete`.
- `clear(pi)` delegates to `persistence.appendClearEntry(clearedGoalId)`.
- `restore()` calls `persistence.setCurrentGoal(reconstructGoal(branch))` and `persistence.syncPersistedSnapshot(currentGoal)`.
- `flushRuntimePersistence()` uses `runtimePersistIntervalMs` and `persistence.getLastRuntimePersistAt()`.

If a full extraction is too risky in one edit, preserve local helper names (`currentGoal()` wrapper, `setCurrentGoal()`) while storing state in the persistence module.

- [ ] **Step 4: Adjust transition planner persist result if needed**

`runtime_accounting` should return `persist: "usage"` for active/budget-limited runtime-only changes. Complete/clear/pause/resume/replace remain `set` or `clear`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npm test -- src/state.test.ts src/goal-persistence.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run full tests and typecheck**

Run:

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/runtime.test.ts src/goal-transition.ts
git commit -m "feat: persist runtime goal usage entries"
```

## Phase Verification

- [ ] State replay tests pass: `npm test -- src/state.test.ts`
- [ ] Persistence module tests pass: `npm test -- src/goal-persistence.test.ts`
- [ ] Runtime persistence tests pass: `npm test -- src/runtime.test.ts`
- [ ] Full tests pass: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Stop for human review if replacing local persistence state in `src/index.ts` causes broad unrelated lifecycle drift
