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

## Requirement Mismatches
- **Problematic deviation: replacement does not fully clear active accounting.**
  - Design requirement: replacing a goal must clear pending continuation state, active accounting, stale queued work state, pending completion state, and recovery state; the transition invariants also say replacing clears pending continuation and active accounting.
  - Evidence: `planGoalTransition` correctly emits `clearActiveAccounting` for goal replacement (`src/goal-transition.ts:63-72`), but the effect handler only clears `activeTurnStartedAt`, `currentTurnHadToolCall`, and `currentTurnIsContinuation` (`src/runtime-state.ts:38-42`). At `turn_end`, token usage is still extracted from the current assistant message and applied to whatever goal is active at that moment (`src/index.ts:468-482`; `src/goal-accounting.ts:33-35`).
  - Confirming test evidence: the test named `create_goal replace_existing clears in-flight turn accounting` actually asserts the replacement goal receives the old in-flight turn's `50` tokens and one turn (`src/runtime.test.ts:802-830`). This contradicts the design's active-accounting clearing requirement.
  - Why it matters: a replacement goal can inherit token/turn usage from work performed for the previous goal, corrupting budgets, turn counts, continuation decisions, and completion accounting.
  - Recommended fix: when replacement clears active accounting, also mark the current turn as detached from goal accounting or record the goal ID active at turn start and skip `turn_end` accounting if it differs from the current goal. Update the test to assert zero inherited tokens/turns for the replacement goal.

## Plan Deviations
- None evaluated. The user explicitly requested not to read plan or phase files, so plan/phase alignment cannot be checked.
- **Acceptable tradeoff: explicit user intent for `replace_existing` is enforced by tool guidance, not runtime proof.** The design says replacement should be allowed only when the user explicitly asked. The implementation documents this in the schema/guidelines (`src/tools.ts:55-64`) but cannot independently prove user intent from the boolean parameter. This is reasonable for a model-facing tool, but relies on prompt/tool compliance.

## Scope Creep / Missing Scope
- **Problematic deviation: package smoke gate is lighter than the design's smoke-gate requirements.**
  - Design requirement: the smoke gate should check package metadata, `pi.extensions`, optional prompts, and that extension registration can load in a lightweight mocked host.
  - Evidence: `scripts/package-smoke.mjs` checks metadata, files, extension path, README/CHANGELOG, and prompt directory existence, but does not import/register the extension with a mocked host. Registration is covered by Vitest (`src/runtime.test.ts`), and `npm run verify` runs tests before smoke, but the smoke gate itself does not include that check.
  - Classification: acceptable tradeoff if the team considers `npm run verify` the gate; problematic deviation if `smoke:package` is expected to be independently sufficient.
  - Recommended fix: either add a lightweight mocked-host registration import to `scripts/package-smoke.mjs`, or update the design/validation notes to state that mocked registration is covered by Vitest within `npm run verify` rather than the smoke script.

## Tests vs Required Behavior
- Positive coverage exists for duplicate `create_goal`, tool replacement, command/tool replacement invalidation, `/goal copy`, transition invariants, runtime usage replay, stale usage ignores, budget-limited replay, recovery classification, recovery pause, recovery reset, continuation blocking, stale queued work, and context rewrite behavior.
- The replacement active-accounting test is misaligned with the design: it asserts usage is charged to the replacement goal after replacement during an in-flight turn (`src/runtime.test.ts:828-830`). This should be inverted to protect the design invariant.
- `npm run verify` passed: typecheck succeeded, all 13 test files / 125 tests passed, and `scripts/package-smoke.mjs` reported `package smoke passed`.

## Spec Alignment Verdict
- Fail
- Reason: Most design areas are implemented, but the active-accounting replacement invariant is contradicted by code and tests. This can corrupt replacement goal accounting and budget behavior, so the implementation does not fully satisfy the design acceptance criteria.

## Required Fixes
1. Fix replacement during an in-flight turn so the replacement goal does not receive token/time/turn accounting from the previous goal's active turn.
2. Update the corresponding runtime test to assert replacement clears/skips inherited active accounting instead of asserting `tokensUsed: 50` and `turnCount: 1`.
3. Decide whether mocked-host extension registration belongs in `scripts/package-smoke.mjs`; if yes, add it, otherwise document that `npm run verify` covers it through Vitest rather than the smoke script.
