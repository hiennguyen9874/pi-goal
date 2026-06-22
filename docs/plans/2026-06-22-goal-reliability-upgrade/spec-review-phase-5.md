# Spec Review

## What Was Done Well
- Added the requested recovery modules (`src/recovery.ts`, `src/recovery-machine.ts`) with conservative classification for context overflow, retryable transient provider errors, and non-retryable provider limit errors.
- Integrated retryable provider-error attention into footer status and automatic continuation blocking (`src/index.ts:536-543`, `src/recovery-machine.ts:102-104`).
- Routed non-retryable recovery pause through the transition planner instead of direct mutation (`src/index.ts:545-552`, `src/goal-transition.ts:142-153`).
- Added focused tests for recovery classification, footer attention, pending recovery continuation blocking, and recovery pause transition behavior.
- Validation run passed:
  - `npm test -- src/recovery.test.ts src/goal-transition.test.ts src/runtime.test.ts src/state.test.ts` passed: 75 tests.
  - `npm run typecheck` passed.
  - `npm test` passed: 117 tests.

## Requirement Mismatches
- **Problematic deviation: silent/context-compaction overflow recovery is not integrated into runtime.**
  - Requirement: Phase 5 goal requires provider/context-overflow recovery; design requires context overflow to increment compaction attempts and repeated context overflow beyond the cap to pause the goal.
  - Evidence: `planRecoveryForSilentContextOverflow()` exists in `src/recovery-machine.ts:98-100`, but grep shows it is only used by `src/recovery.test.ts`, not by runtime. `src/index.ts:413-417` handles `session_compact` by restoring, flushing, and potentially continuing without recording an overflow attempt or pausing after repeated compactions.
  - Why it matters: repeated silent context-overflow compactions can continue without ever reaching recovery pause, so the implementation does not satisfy the context-overflow half of Phase 5.
  - Classification: problematic deviation.

- **Problematic deviation: explicit pause does not reset recovery attention.**
  - Requirement: design says clear, replace, complete, and explicit pause reset or clear relevant recovery state.
  - Evidence: `src/goal-transition.ts:84-94` handles normal `pause` effects but does not include `resetRecovery`; `resetRecovery` is included for create/replace, resume, clear, and complete.
  - Why it matters: stale pending/paused recovery attention can remain after a user intentionally pauses a goal, causing status to show recovery attention instead of the normal paused state.
  - Classification: problematic deviation.

- **Acceptable tradeoff with a gap: pending recovery status is visible but next action is vague.**
  - Requirement: design says recovery status must explain what happened and tell the user whether `/goal resume`, another user message, or external action is needed.
  - Evidence: pending status in `src/recovery.ts:81-86` says `Waiting for the provider/host to recover`; paused status says to use `/goal resume`.
  - Why it matters: paused recovery gives a concrete next action, but pending recovery does not clearly state whether the user should wait, send another message, or take external action.
  - Classification: acceptable tradeoff if pending truly means wait-only; otherwise problematic and should be clarified in copy/tests.

## Plan Deviations
- **Problematic deviation: Task 1's silent context-overflow planner was implemented and unit-tested but not connected to the Phase 5 runtime paths.**
  - Phase references include `session_compact`, and the design explicitly covers context-overflow compaction attempts.
  - Current `session_compact` path (`src/index.ts:413-417`) does not call the recovery machine.

- **No phase-count issue found.**
  - Plan has 7 phases, matching the large-plan cap in the design.

## Scope Creep / Missing Scope
- **Missing scope:** runtime handling for silent context overflow / repeated compaction attempts.
- **Missing scope:** recovery reset on explicit user pause.
- **No unjustified feature creep found.** The changes are within the Phase 5 recovery/status/transition scope.

## Tests vs Required Behavior
- Tests cover:
  - context-overflow and provider-error classification (`src/recovery.test.ts`).
  - retryable pending recovery attention and continuation blocking (`src/runtime.test.ts`).
  - non-retryable provider recovery pause (`src/runtime.test.ts`).
  - recovery pause transition effects (`src/goal-transition.test.ts`).
  - footer recovery attention formatting (`src/state.test.ts`).
- Tests do **not** cover:
  - `session_compact` or silent context overflow incrementing compaction attempts and pausing after repeated overflow.
  - explicit `/goal pause` or transition pause clearing existing recovery attention.
  - pending recovery status copy providing a concrete next user action.

## Spec Alignment Verdict
- Fail
- Reason: Provider-error recovery is substantially implemented, but Phase 5's context-overflow recovery is incomplete because silent/repeated compaction overflow is not wired into runtime. A design-required recovery reset on explicit pause is also missing.

## Required Fixes
1. Wire silent context-overflow recovery into the appropriate runtime path, most likely `session_compact` and/or post-agent context-overflow detection, by calling `planRecoveryForSilentContextOverflow()` for active goals and applying `noop`/`pause` actions consistently with provider-error recovery.
2. Add runtime tests proving repeated silent context overflow pauses the active goal and cancels unsafe continuation work.
3. Add `resetRecovery` to the explicit `pause` transition effects, or otherwise clear recovery state when users explicitly pause a goal, with a regression test.
4. Clarify pending recovery status copy or tests so the required next action is explicit.
