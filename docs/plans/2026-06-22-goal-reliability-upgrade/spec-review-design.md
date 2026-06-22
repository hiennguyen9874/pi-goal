# Spec Review

Review basis: `docs/plans/2026-06-22-goal-reliability-upgrade/design.md` only, per request. I did not read `plan.md` or phase files. Code changes were reviewed from `git diff 09b743be4cb583477abfa1bf3ac2da41d9c7fa83...HEAD` and direct file inspection.

## What Was Done Well
- Package hygiene is substantially implemented: `package.json` now describes `pi-goal`, has empty runtime dependencies, ships README/CHANGELOG, exposes `typecheck` and `verify`, and keeps `pi.extensions` pointed at `./src/index.ts`.
- Goal-writing onboarding is present: `skills/pi-goal-writer/SKILL.md`, `prompts/create-goal.md`, richer `create_goal` tool descriptions, and README guidance all cover auditable completion contracts and avoid invented token budgets.
- `create_goal` supports `replace_existing` and preserves duplicate refusal when it is absent or false (`src/tools.ts:66-74`). Command and tool replacement both route through `planGoalTransition(... create_or_replace ...)` (`src/index.ts:344-351`).
- `/goal copy` is implemented with no-goal and clipboard-failure handling, and it does not call lifecycle mutation paths.
- The requested module seams exist: runtime state, goal transition/effects, persistence, accounting, and recovery modules were added.
- Runtime `usage` entries and replay guards are implemented defensively for goal ID, monotonic counters, monotonic `updatedAt`, and budget-limited replay (`src/state.ts:229-263`).
- Recovery classification covers context overflow, retryable transient provider errors, and non-retryable provider errors, with pending/paused status text.
- Verification currently passes: `npm run verify` completed successfully with typecheck, 125 Vitest tests, and package smoke.
- Replacement active accounting now records the goal ID active at turn start and skips turn-end accounting if the current goal changed before `turn_end`.

## Requirement Mismatches
- None remaining.

## Resolved Requirement Mismatches
- **Replacement now clears/skips active accounting for in-flight turns.**
  - Design requirement: replacing a goal must clear pending continuation state, active accounting, stale queued work state, pending completion state, and recovery state.
  - Resolution: runtime state now tracks the active turn's goal ID. `turn_end` accounting only applies when the current active goal still matches that recorded goal ID; otherwise active turn accounting is cleared without charging usage to the replacement goal.
  - Test update: `create_goal replace_existing clears in-flight turn accounting` now asserts the replacement goal keeps `tokensUsed: 0`, `timeUsedSeconds: 0`, and `turnCount: 0`.

## Plan Deviations
- None evaluated. The user explicitly requested not to read plan or phase files, so plan/phase alignment cannot be checked.
- **Acceptable tradeoff: explicit user intent for `replace_existing` is enforced by tool guidance, not runtime proof.** The design says replacement should be allowed only when the user explicitly asked. The implementation documents this in the schema/guidelines (`src/tools.ts:55-64`) but cannot independently prove user intent from the boolean parameter. This is reasonable for a model-facing tool, but relies on prompt/tool compliance.

## Scope Creep / Missing Scope
- **Package smoke gate now includes mocked-host extension registration.**
  - Design requirement: the smoke gate should check package metadata, `pi.extensions`, optional prompts, and that extension registration can load in a lightweight mocked host.
  - Resolution: `scripts/package-smoke.mjs` now transpiles the extension into a temporary ESM smoke directory, imports the default extension, and registers it against a minimal mocked Pi host without provider credentials or external services.
  - Classification: resolved.

## Tests vs Required Behavior
- Positive coverage exists for duplicate `create_goal`, tool replacement, command/tool replacement invalidation, `/goal copy`, transition invariants, runtime usage replay, stale usage ignores, budget-limited replay, recovery classification, recovery pause, recovery reset, continuation blocking, stale queued work, and context rewrite behavior.
- The replacement active-accounting test now aligns with the design: it asserts usage from the old in-flight turn is not charged to the replacement goal.
- `npm run verify` passed: typecheck succeeded, all 13 test files / 125 tests passed, and `scripts/package-smoke.mjs` reported `package smoke passed`.

## Spec Alignment Verdict
- Pass
- Reason: The previously blocking active-accounting replacement invariant is now implemented and covered by regression test, and the smoke gate now includes mocked-host extension registration.

## Required Fixes
- None remaining.
