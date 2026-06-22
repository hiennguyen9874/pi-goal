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
- **Fixed: tool replacement now clears required runtime state.**
  - Status: fixed.
  - Verification decision: verified real in `src/index.ts`; tool replacement previously invalidated continuation state but did not clear active turn accounting or `pendingCompletionGoalId`.
  - Fix applied: added `invalidateReplacementRuntime()` in `src/index.ts` to clear pending continuation/stale queued work state, active turn accounting, and pending completion state before persisting a tool-created replacement. Added regression coverage in `src/runtime.test.ts` for in-flight elapsed/tool-call accounting.

## Plan Deviations
- **Fixed: prescribed focused test commands now run as specified.**
  - Status: fixed.
  - Verification decision: verified real by running `npm test -- src/runtime.test.ts`, which failed with `No test files found` under the previous `vitest.config.ts` include.
  - Fix applied: widened Vitest include to `src/*.test.ts` and converted co-located Node `node:test` imports to Vitest `test` imports so `npm test -- src/commands-tools.test.ts`, `npm test -- src/runtime.test.ts`, full `npm test`, and `npm run verify` execute the intended suites.
- **Acceptable tradeoff: Phase 2 does not route command/tool replacement through the future transition/effects seam.**
  - Status: deferred.
  - Reason: verified as intentionally scheduled for Phase 3. Current Phase 2 fix adds a small runtime invalidation seam without pre-implementing the full transition/effects architecture.
- **Cannot verify: Pi packaged prompt support.**
  - Status: deferred.
  - Reason: no local host/API compatibility check is available in this phase. Manifest still declares `pi.prompts: ["./prompts"]`; stop for human review if target Pi package support differs.

## Scope Creep / Missing Scope
- **Fixed required replacement invalidation scope:** active accounting and pending completion invalidation are now cleared from the tool replacement path via `invalidateReplacementRuntime()`.
- **No unjustified feature creep found:** the implementation did not add shell clipboard fallbacks, new dependencies, unrelated refactors, or visible tool-created/replaced events. That matches the phase constraints.
- **Recovery reset not currently checkable:** Status: deferred. Phase/design mention recovery reset on replacement, but recovery state is scheduled for Phase 5 and does not exist in current runtime state.

## Tests vs Required Behavior
- `npm test -- src/package-manifest.test.ts`: PASS, 5 tests.
- `npm test -- src/commands-tools.test.ts`: PASS, 18 tests.
- `npm test -- src/runtime.test.ts`: PASS, 32 tests.
- `npm test -- src/commands-tools.test.ts src/runtime.test.ts`: PASS, 50 tests.
- `npm test`: PASS, 7 files / 86 tests.
- `npm run typecheck`: PASS.
- `npm run verify`: PASS; runs typecheck and the full Vitest suite.

## Spec Alignment Verdict
- Pass after fixes
- Reason: Verified replacement invalidation and test-command setup issues are fixed; deferred items are explicitly scheduled or not locally verifiable in Phase 2.

## Required Fixes
1. Fixed. Tool-created replacement now clears active turn accounting and pending completion state in addition to queued continuation and stale queued work state; regression coverage verifies a replacement does not inherit elapsed/tool-call accounting from the old goal’s in-flight turn.
2. Fixed. Declared test/verification setup now runs the intended co-located Vitest suite for focused commands, full `npm test`, and `npm run verify`.
