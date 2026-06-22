# Spec Review

## What Was Done Well
- Phase scope was kept to runtime usage persistence/replay hardening. The implementation is concentrated in `src/state.ts`, `src/goal-persistence.ts`, `src/index.ts`, and matching tests.
- The phase count remains aligned with the large-plan cap: `plan.md` has 7 phases, matching the design cap of large <= 7.
- `usage` entries were added to the state entry model with the required fields: `goalId`, runtime counters, `status`, `updatedAt`, optional `statusBarEnabled`, and `at` (`src/state.ts:43-55`).
- Reconstruction now applies matching runtime `usage` entries and ignores mismatched, decreasing, out-of-order, and invalid budget-limited usage according to the planned guards (`src/state.ts:225-264`).
- A dedicated persistence module was added with current-goal tracking, persisted-snapshot tracking, runtime usage fallback to `set`, clear entry support, and runtime flush timestamp support (`src/goal-persistence.ts:30-100`).
- Runtime accounting is integrated with transition planning: runtime-only accounting returns `persist: "usage"` (`src/goal-transition.ts:132-140`), and `src/index.ts` routes `usage` plans through runtime persistence (`src/index.ts:231-236`, `src/index.ts:470-484`).
- Required focused runtime behaviors are tested: accounting can persist a `usage` entry after an initial `set`, and completion still persists a full complete `set` (`src/runtime.test.ts:171-207`).

## Requirement Mismatches
- **Important - problematic deviation: malformed numeric usage entries are not fully rejected.**
  - Explicit requirement: Phase 4 says malformed entries should be skipped consistently with robust reconstruction behavior, and the design says runtime usage replay should be defensive.
  - Evidence: `isGoalEntry()` accepts usage numeric fields using only `typeof ... === "number"` (`src/state.ts:216-222`). `canApplyRuntimeUsageEntry()` then only compares the values with `<` (`src/state.ts:229-236`), and `reconstructGoal()` assigns those values into goal state (`src/state.ts:253-259`). Values such as `NaN` are `typeof "number"`, all `<` comparisons with `NaN` are false, and would therefore be applied instead of skipped.
  - Why it matters: a malformed custom entry can corrupt restored counters/status timestamps, contradicting the replay-hardening intent.
  - Minimal fix: require finite numeric usage fields in `isGoalEntry()` or `canApplyRuntimeUsageEntry()` with `Number.isFinite(...)`, and preferably add non-negative/integer checks for counters and timestamps.
- **Observation - acceptable tradeoff: `src/index.ts` still mirrors `currentGoal` outside the persistence module.**
  - Explicit plan text said to replace local persistence fields “where practical” and allowed preserving local helper names if a full extraction was too risky.
  - Evidence: local `currentGoal` remains in `src/index.ts:78`, while persistence also has its own current goal (`src/goal-persistence.ts:31`) and is synchronized by helper calls (`src/index.ts:139-141`, `src/index.ts:156-158`).
  - Classification: acceptable tradeoff, because the phase allowed partial delegation and tests cover the main runtime paths. This should be revisited in phase 6 runtime integration cleanup.

## Plan Deviations
- None blocking.
- **Acceptable tradeoff:** Task 2 requested `GoalPersistenceSource = "set" | "runtime" | "clear"`; the type exists (`src/goal-persistence.ts:17`), but `persistCurrent()` accepts only `"set" | "runtime"` (`src/goal-persistence.ts:78`) and clear is handled by `appendClearEntry()` (`src/goal-persistence.ts:89-95`). This matches the required method list and behavior, so no fix is required.
- **Acceptable tradeoff:** Task 3 suggested removing/delegating local persistence fields in `src/index.ts`. The implementation delegates persisted snapshot and runtime timestamp to `createGoalPersistence()` but keeps local `currentGoal`. This is allowed by the phase note permitting lower-risk incremental integration.

## Scope Creep / Missing Scope
- No material scope creep found. The implementation did not add recovery, smoke gate, or unrelated lifecycle features beyond a small transition persist-result update needed by phase 4.
- Missing scope is limited to the malformed numeric replay guard noted above. Required core behaviors for usage replay, persistence fallback, runtime integration, and completion full-set persistence are present.

## Tests vs Required Behavior
- Covered:
  - Matching active usage replay (`src/state.test.ts`).
  - Mismatched goal ID ignored (`src/state.test.ts`).
  - Decreasing usage and `updatedAt` rewind ignored (`src/state.test.ts`).
  - Budget-limited usage requires usage at or over budget (`src/state.test.ts`).
  - Runtime persistence writes `usage` when static fields match (`src/goal-persistence.test.ts`).
  - Runtime persistence falls back to `set` when static fields change (`src/goal-persistence.test.ts`).
  - Runtime turn accounting persists `usage` and completion persists full `set` (`src/runtime.test.ts:171-207`).
- Gap:
  - No test covers malformed numeric usage fields such as `NaN`, `Infinity`, negative timestamps, or non-finite counters. This is the same replay-hardening mismatch described above.
- Verification run during review:
  - `npm test -- src/state.test.ts src/goal-persistence.test.ts src/runtime.test.ts` passed: 56 tests passed.
  - `npm run typecheck` passed.
  - `npm test` passed: 104 tests passed.

## Spec Alignment Verdict
- Pass with issues
- Reason: Phase 4’s primary behavior is implemented and verified, but replay hardening is incomplete for malformed numeric usage entries. This does not invalidate the main feature, but it should be fixed before considering the phase fully robust against malformed journal data.

## Required Fixes
1. Harden `usage` entry validation so malformed numeric values cannot be applied during reconstruction. Add regression tests for at least `NaN` or non-finite usage fields being skipped.
