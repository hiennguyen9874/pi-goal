# Spec Review

## What Was Done Well
- Phase 1 package metadata was substantially updated as requested: `package.json` now describes `pi-goal`, includes goal-related keywords, keeps `pi.extensions` at `./src/index.ts`, includes README/CHANGELOG in `files`, removes the hashline runtime dependencies, and adds `typecheck`/`verify` scripts (`package.json:4`, `package.json:13-23`, `package.json:25-37`, `package.json:44-55`).
- User-facing baseline docs were added with the required README sections and changelog baseline (`README.md:1-46`, `CHANGELOG.md:1-8`).
- A focused package manifest test was added and covers metadata, scripts, removed dependencies, and docs presence (`src/package-manifest.test.ts:17-56`). The focused command `npm test -- src/package-manifest.test.ts` passes.
- The implementation used the two expected Phase 1 commits from history: `3255dc0 chore: fix pi-goal package metadata` and `cae4219 docs: document pi-goal package`.

## Requirement Mismatches
- **problematic deviation — Typecheck does not pass.** Phase 1 explicitly requires `npm run typecheck` to pass (`phase-1.md:130-134`) and lists typecheck as phase verification (`phase-1.md:268-270`). Current `package.json` defines `typecheck` as required (`package.json:47`), but running it fails with TypeScript errors in dependencies and source files, including `undici-types` resolution failures, missing `@modelcontextprotocol/sdk`, and source type errors in `src/commands.ts`, `src/index.ts`, `src/state.ts`, and `src/tools.ts`. This blocks the Phase 1 goal of adding a working validation foundation.
- **problematic deviation — Full baseline verify does not pass.** Phase 1 requires `npm run verify` to pass (`phase-1.md:251-255`, `phase-1.md:268-270`) and `verify` is correctly defined as `npm run typecheck && npm test` (`package.json:48`). Because `npm run typecheck` fails, `npm run verify` cannot pass.
- **problematic deviation — `npm test` does not pass under the new configuration.** The verify script depends on `npm test` (`package.json:48`). Running `npm test` now fails with six Vitest suite errors: `No test suite found` for existing `node:test` files such as `src/state.test.ts`, `src/runtime.test.ts`, and others. This is caused by the added `src/**/*.test.ts` include in `vitest.config.ts:5`, which brings existing `node:test`-style tests into Vitest collection in a way Vitest reports as failed suites.
- **acceptable tradeoff with risk — The manifest test does not follow the requested existing test style.** Phase 1 says to follow `src/state.test.ts` using `node:test` plus `node:assert/strict` (`phase-1.md:24-29`), but the new manifest test uses Vitest imports and `expect` (`src/package-manifest.test.ts:1`, `src/package-manifest.test.ts:20-55`). The behavior being tested is mostly aligned, but this diverges from the explicit test-style requirement and contributes to inconsistency with the rest of the suite.

## Plan Deviations
- **problematic deviation — Unplanned config changes were introduced without producing the required passing validation.** Phase 1 file lists Task 1 files as `package.json`, `package-lock.json`, and `src/package-manifest.test.ts` (`phase-1.md:17-20`), Task 2 files as `README.md`, `CHANGELOG.md`, and `src/package-manifest.test.ts` (`phase-1.md:145-148`), and Task 3 files as `package.json` and `src/package-manifest.test.ts` (`phase-1.md:237-242`). The implementation also changed `tsconfig.json:8` and `vitest.config.ts:5-7`. Updating Vitest's stale glob could be justified by `AGENTS.md`/workflow guidance, but the resulting `npm test` failure means this deviation is not currently successful.
- **problematic deviation — `tsconfig.json` removed `skipLibCheck` while adding the typecheck gate.** The development workflow documents `skipLibCheck: true` as the baseline TypeScript configuration. The implementation replaced it with `allowImportingTsExtensions` (`tsconfig.json:8`). This likely exposed third-party declaration errors during `npm run typecheck`, contradicting the phase expectation that typecheck pass.
- **acceptable tradeoff — The implementation did not create the optional third commit.** Task 3 says to commit only if adjustments were needed and not create an empty commit if verification already passed (`phase-1.md:257-264`). There is no separate Task 3 commit, which is acceptable if no extra edits were intended. However, verification did not pass, so the phase remains incomplete.

## Scope Creep / Missing Scope
- **Missing required scope — A working validation foundation is not delivered.** The core Phase 1 goal is to add a typecheck/verify foundation before behavior changes (`phase-1.md:3`). The scripts exist, but the required validation does not pass.
- **Scope creep / problematic deviation — Test runner configuration was changed beyond the phase file list and currently breaks full tests.** `vitest.config.ts` was not listed as a Phase 1 target file, and the change to include `src/**/*.test.ts` causes `npm test` failures instead of enabling the baseline verify gate.
- **No issue found — Package metadata/docs scope is otherwise covered.** The requested description, keywords, files, scripts, dependency removal, README sections, and changelog baseline are present.

## Tests vs Required Behavior
- Focused manifest test: **Passes**. Command run: `npm test -- src/package-manifest.test.ts`; result: 1 file passed, 4 tests passed.
- Typecheck: **Fails**. Command run: `npm run typecheck`; result: TypeScript errors in dependency declarations and source files, so Phase 1 Step 5 and phase verification are not met.
- Full test suite: **Fails**. Command run: `npm test`; result: existing `node:test` files are collected by Vitest and reported as `No test suite found` failed suites.
- Full verify: **Fails by dependency**. Since `verify` is `npm run typecheck && npm test`, it cannot pass while both typecheck and full tests fail.

## Spec Alignment Verdict
- Fail
- Reason: The metadata and documentation portions are mostly aligned, but the central Phase 1 acceptance criteria require `npm run typecheck` and `npm run verify` to pass. They do not. The implementation also introduced unplanned config changes that break `npm test`, so the validation foundation is not operational.

## Required Fixes
1. Restore or adjust `tsconfig.json` so `npm run typecheck` passes, while preserving support for the repo's `.ts` extension imports. At minimum, re-evaluate the removal of `skipLibCheck` and fix any remaining source type errors surfaced by `tsc --noEmit`.
2. Fix the test runner setup so `npm test` passes. Either make Vitest correctly execute the existing `node:test`-style co-located tests, convert tests consistently, or avoid collecting files that Vitest cannot treat as suites.
3. After fixes, rerun and document successful results for `npm test -- src/package-manifest.test.ts`, `npm run typecheck`, and `npm run verify`.
4. Consider aligning `src/package-manifest.test.ts` with the requested `node:test` + `node:assert/strict` style, or explicitly update the phase/spec if Vitest style is now the intended package-manifest test pattern.
