# Spec Review

## What Was Done Well
- Phase 2 implementation was isolated to the expected phase commits: `bf228fb` (`feat: add pi-goal writing guidance`), `65826e3` (`feat: allow explicit goal replacement tool`), and `182b74b` (`feat: add goal copy command`).
- Package exposure for the onboarding bundle matches the phase intent: `package.json` ships `skills` and `prompts`, and declares `pi.prompts: ["./prompts"]` (`package.json:25-39`).
- The goal-writing skill includes the required completion-contract framing and the six strong-goal concepts including Outcome, Verification surface, Constraints, Boundaries, Iteration policy, and Blocked stop condition (`skills/pi-goal-writer/SKILL.md`).
- The create-goal prompt preserves the required replacement and token-budget rules: it instructs `replace_existing: true` for explicit prompt invocation and says not to invent token budgets (`prompts/create-goal.md:9-13`).
- `create_goal` exposes `replace_existing`, richer completion-contract guidance, duplicate refusal by default, and replacement only when `replace_existing === true` (`src/tools.ts:13-24`, `src/tools.ts:53-75`).
- `/goal copy` is parsed, completed, and handled before lifecycle-mutating actions; it copies the objective when possible and returns without calling `setGoal` or `clearGoal` (`src/commands.ts:30-33`, `src/commands.ts:83-91`, `src/commands.ts:131-138`).
- The clipboard adapter stays intentionally host-API-only and avoids shelling out, matching the phase instruction to keep it smaller than the Fitch adapter (`src/clipboard.ts:1-22`).
- Plan phase count is within the design cap for a large feature: the plan has 7 phases, matching the `large <= 7` cap.

## Requirement Mismatches
- **Problematic deviation: tool replacement does not clear all required runtime state.**
  - Explicit requirement: design says replacing a goal must clear pending continuation state, active accounting, stale queued work state, pending completion state, and recovery state; Phase 2 Task 2 also says tool-created replacement must rely on `src/index.ts` to clear runtime state.
  - Evidence: tool `setGoal` calls only `invalidateContinuation()`, `persist()`, `syncGoalTools()`, and `refreshStatus()` (`src/index.ts:285-292`). `invalidateContinuation()` clears continuation generation/pending message/stale queued work fields, but it does not call `clearActiveTurnAccounting()` and does not clear `pendingCompletionGoalId` (`src/index.ts:179-190`). The active accounting fields and pending completion field are defined at `src/index.ts:90-93`, and the only local helper that clears active accounting is `clearActiveTurnAccounting()` at `src/index.ts:99-103`.
  - Why it matters: if `create_goal` with `replace_existing` is called during an active turn, the replacement goal can inherit elapsed-time/tool-call accounting from the prior goal at `turn_end` (`src/index.ts:417-431`). Pending completion state from a prior goal also remains until a later turn-end comparison clears or ignores it, contrary to the explicit invalidation contract.
  - Classification: problematic deviation.
  - Required fix: add a shared replacement/runtime-invalidation path that clears pending continuation, stale queued work, active turn accounting, and pending completion before persisting the replacement goal. Recovery reset can be added when recovery state exists in a later phase, but current replacement code should be structured so that reset has a single obvious place.

## Plan Deviations
- **Problematic deviation: prescribed focused test commands do not run as specified.**
  - Explicit phase requirement: Phase 2 repeatedly says to run `npm test -- src/commands-tools.test.ts`, `npm test -- src/runtime.test.ts`, and the combined focused command, with expected PASS.
  - Evidence: `vitest.config.ts` includes only `src/package-manifest.test.ts`, so `npm test -- src/commands-tools.test.ts` exits with `No test files found, exiting with code 1`. The declared `npm test` command therefore does not execute `src/commands-tools.test.ts` or `src/runtime.test.ts`.
  - Classification: problematic deviation.
  - Required fix: make the project’s declared test command run the intended co-located test suite, either by converting Node `node:test` tests to Vitest-compatible tests and widening `vitest.config.ts`, or by updating scripts/verification to run both Vitest and Node test files.
- **Acceptable tradeoff: Phase 2 does not route command/tool replacement through the future transition/effects seam.**
  - Explicit phase note: Task 2 says Phase 3 will route command and tool replacement through transition effects.
  - Evidence: command and tool paths still use local runtime helpers in `src/index.ts:285-321`.
  - Classification: acceptable tradeoff for Phase 2, as long as Phase 3 completes the shared transition path.
- **Cannot verify: Pi packaged prompt support.**
  - Explicit phase note: stop for human review if Pi package prompt support differs from `pi.prompts: ["./prompts"]`.
  - Evidence checked: manifest declares the field (`package.json:34-39`), but no host/API compatibility check is present in this phase.
  - Classification: observation; not a mismatch unless the target Pi package format rejects this field.

## Scope Creep / Missing Scope
- **Missing required replacement invalidation scope:** active accounting and pending completion invalidation are missing from the tool replacement path, as detailed above.
- **No unjustified feature creep found:** the implementation did not add shell clipboard fallbacks, new dependencies, unrelated refactors, or visible tool-created/replaced events. That matches the phase constraints.
- **Recovery reset not currently checkable:** Phase/design mention recovery reset on replacement, but recovery state is scheduled for Phase 5 and does not exist in current runtime state. This should be carried forward as a Phase 5/transition seam requirement, not treated as a current code omission beyond ensuring the invalidation seam is extensible.

## Tests vs Required Behavior
- `npm test -- src/package-manifest.test.ts`: PASS, 5 tests.
- `npm test -- src/commands-tools.test.ts`: FAIL before running tests; Vitest reports no matching test files because `vitest.config.ts` includes only `src/package-manifest.test.ts`.
- `npm run typecheck`: PASS.
- `node --test src/commands-tools.test.ts`: PASS, 18 tests. This confirms the added command/tool tests pass under Node’s test runner, but it is not the phase-prescribed command.
- `node --test src/runtime.test.ts`: PASS, 31 tests. This confirms the pending-continuation regression passes under Node’s test runner, but it does not cover active accounting or pending completion invalidation.
- `npm test`: PASS, but only runs `src/package-manifest.test.ts`; this is weaker than the phase/full-suite intent.
- `npm run verify`: PASS, but because it delegates to the same narrow `npm test`, it does not verify command/tool/runtime behavior.

## Spec Alignment Verdict
- Fail
- Reason: Most user-facing Phase 2 features are present, but a required safety behavior for tool replacement is incomplete, and the phase-prescribed test commands do not run the intended test files. These are spec/plan alignment issues, not style concerns.

## Required Fixes
1. Update the tool-created replacement runtime path to clear active turn accounting and pending completion state in addition to queued continuation and stale queued work state. Add regression coverage that would fail if a replacement goal inherits elapsed time/tool-call accounting from the old goal’s in-flight turn.
2. Fix the declared test/verification setup so `npm test -- src/commands-tools.test.ts`, `npm test -- src/runtime.test.ts`, `npm test`, and `npm run verify` execute the intended command/tool/runtime tests, not only `src/package-manifest.test.ts`.
