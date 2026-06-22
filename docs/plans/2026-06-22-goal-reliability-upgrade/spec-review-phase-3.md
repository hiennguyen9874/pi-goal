# Spec Review

## What Was Done Well
- The requested transition planner and effect adapter exist in the working tree: `src/goal-transition.ts` and `src/goal-transition-effects.ts`.
- The planner defines the requested request/effect/plan types and implements create/replace, pause, resume, clear, complete, runtime accounting, and recovery pause paths.
- `src/index.ts` now routes command create/replace/pause/resume, tool create/replace, clear, reload pause, runtime accounting, and final completion persistence through `planGoalTransition()` and `applyGoalTransitionEffects()`.
- The requested replacement regression test exists in `src/runtime.test.ts` and verifies command/tool replacement do not send the old queued continuation.
- Verification passed:
  - `npm test -- src/goal-transition.test.ts src/goal-transition-effects.test.ts src/commands-tools.test.ts src/runtime.test.ts`
  - `npm run typecheck`
  - `npm test`

## Requirement Mismatches
- **Status: fixed — budget-limit transition now clears continuation/accounting effects.**
  - Requirement: the design says “Completing, clearing, pausing, replacing, or budget-limiting a goal clears pending continuation and active accounting” (`design.md:163`).
  - Verification: `runtime_accounting` now adds `clearContinuation` and `clearActiveAccounting` when `request.nextGoal.status === "budget_limited"` (`src/goal-transition.ts`).
  - Regression coverage: `src/goal-transition.test.ts` now covers the budget-limited cleanup invariant.

## Plan Deviations
- **Status: rejected as stale — phase commits are present in git history.**
  - Requirement: Phase 3 has commit steps for the planner, effects adapter, and runtime routing (`phase-3.md:230-231`, `phase-3.md:321-323`, `phase-3.md:441-445`).
  - Verification: `git log --oneline -- src/goal-transition.ts src/goal-transition-effects.ts` shows Phase 3 transition commits, including `e0b7a12 feat: implement goal transition effects and associated tests`; `git status --short` does not show Phase 3 source files as untracked.
- **Acceptable tradeoff: `persist: "usage"` still writes full set entries in Phase 3.**
  - Requirement: `runtime_accounting` should return `persist: "usage"` (`phase-3.md:213`).
  - Evidence: the planner returns `persist: "usage"` (`src/goal-transition.ts:132-136`), while `applyTransitionPlan()` still routes both `set` and `usage` through existing `persist()` (`src/index.ts:227-230`).
  - Classification: acceptable for Phase 3 because Phase 4 owns actual runtime usage entry persistence, and Phase 3 explicitly says to keep current persistence behavior (`phase-3.md:410`).

## Scope Creep / Missing Scope
- **Status: fixed — budget-limited cleanup invariant is now covered.**
  - Requirement: transition planner tests should enforce lifecycle/accounting invariants (`design.md:330`), and the design specifically includes budget-limited cleanup (`design.md:163`).
  - Verification: `src/goal-transition.test.ts` includes `budget_limited accounting clears continuation and active accounting`.
- No unrelated feature scope was found in the Phase 3 working-tree changes.

## Tests vs Required Behavior
- Covered:
  - Planner create/replace, pause, resume, complete effects.
  - Runtime accounting identity and monotonic usage validation.
  - Budget-limited threshold validation.
  - Effect adapter handler ordering.
  - Runtime command/tool replacement cancellation of stale pending continuation.
  - Existing command/tool/runtime regressions still pass.
  - Budget-limited transitions clearing pending continuation and active accounting, required by `design.md:163`.
- Rejected as stale:
  - Commit/history-based phase traceability; Phase 3 transition commits are present in current git history.

## Spec Alignment Verdict
- **Pass**
- Reason: The explicit budget-limited cleanup invariant is now implemented and covered by a focused regression test. The commit/history finding was rechecked and rejected as stale against current git history.

## Required Fixes
1. **Fixed:** `planGoalTransition()` now adds `clearContinuation` and `clearActiveAccounting` when `runtime_accounting` results in `budget_limited`, with a focused regression test.
2. **Rejected as stale:** Phase 3 transition commits are present in current git history; no code/report workaround needed.
