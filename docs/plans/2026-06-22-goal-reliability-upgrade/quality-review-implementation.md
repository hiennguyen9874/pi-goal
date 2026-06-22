# Code Quality Review

## What Was Done Well
- The new transition planner centralizes the highest-risk lifecycle invariants for runtime accounting, budget transitions, terminal transitions, and replacement (`src/goal-transition.ts:41-57`, `src/goal-transition.ts:63-155`).
- Replay of compact runtime usage entries is defensive: malformed entries are skipped, goal IDs must match, counters must be monotonic, and `budget_limited` usage is only accepted when usage is at or above budget (`src/state.ts:213-270`).
- Boundary behavior is covered with focused tests for replacement, stale queued work, compact usage replay, recovery, command/tool UX, transition invariants, package metadata, and runtime integration. Verification passed with `npm run verify`.
- The implementation avoids a large new framework and keeps most changes local to small modules with co-located tests.

## Critical
- None.

## Important
### Transition effect advertises queued continuation but handler is a no-op
- Files: `src/goal-transition.ts:96-105`, `src/index.ts:184-188`, `src/index.ts:356-359`
- Problem: The transition planner emits `markContinuationQueued` on resume, but the runtime handler intentionally does nothing. Resume only actually schedules continuation through a separate explicit command-path call in `registerGoalCommand`.
- Why it matters: This weakens the transition/effects seam: tests can assert that an effect exists while the runtime effect has no behavior. A future tool/runtime caller that applies the transition plan but does not remember the extra explicit scheduling call will silently fail to queue continuation after resume.
- Minimal fix: Either remove `markContinuationQueued` from the transition/effects model and keep scheduling explicit everywhere, or implement the handler so applying a resume transition is sufficient to mark/schedule the pending continuation. The smaller fix is to remove the misleading effect and test the explicit scheduling path.

### Unused peer dependencies remain declared
- Files: `package.json:42-47`
- Problem: `@earendil-works/pi-ai`, `@earendil-works/pi-tui`, and `@sinclair/typebox` are declared as peer dependencies, but the tracked source only imports `@earendil-works/pi-coding-agent`.
- Why it matters: Peer dependencies affect package installation and host compatibility expectations. Declaring unused peers creates unnecessary install warnings/requirements and undermines the package-hygiene goal.
- Minimal fix: Remove unused peer dependencies, or add a short justification if Pi package policy requires them. Keep only peers actually required by this extension at runtime.

## Suggestions
### Remove unused recovery/runtime fields and constants
- Files: `src/runtime-state.ts:16`, `src/runtime-state.ts:36`, `src/index.ts:185`, `src/recovery.ts:3`, `src/recovery-machine.ts:106-108`
- Observation: `budgetWarningSentForGoalId`, `HOST_OVERFLOW_RECOVERY_REASON`, and `requireRecoveryUserStart` are present but not used by tracked runtime code.
- Benefit: Reduces cognitive load in reliability-sensitive state handling and avoids implying incomplete budget-warning or host-overflow flows.
- Suggested refinement: Delete these until a current behavior needs them, or wire them into an actual tested path.

### Keep direct current-goal mutation on a cleanup list
- Files: `src/index.ts:160-169`, `src/index.ts:252-258`, `src/index.ts:281-286`, `src/index.ts:408-420`
- Observation: Some runtime paths still mutate `currentGoal` directly for scheduling/input bookkeeping outside the transition planner.
- Benefit: Moving these through a small helper or transition request later would make the lifecycle boundary easier to audit.
- Suggested refinement: Do not refactor immediately unless extending these paths; when touched next, route the mutation through the same persistence/transition seam or a narrowly named runtime helper.

## Tests and Verification
- Ran `npm run verify` successfully.
- Result: typecheck passed, 13 Vitest files passed, 125 tests passed, package smoke passed.
- Edge cases reviewed: duplicate/replacement goals, active/paused/resumed transitions, budget crossing, monotonic usage replay, malformed/stale usage entries, clipboard failure path, stale queued work, recovery pause/pending behavior, and session compact behavior.
- Error handling and validation reviewed at relevant boundaries: objective validation, token-budget parsing, tool duplicate protection, clipboard failure notification, runtime accounting invariant checks, and persisted usage replay guards.
- Spec alignment note: this is a quality review using the provided design as context; it does not constitute a full phase-by-phase requirements approval.

## Quality Verdict
- Pass with issues
- Reason: The implementation is broadly correct, well tested, and appropriately modular for the requested reliability upgrade. No merge-blocking correctness bugs were found. The misleading no-op transition effect and unused peer dependencies should be cleaned up because they create real maintainability/package risks, but they do not currently break the verified behavior.
