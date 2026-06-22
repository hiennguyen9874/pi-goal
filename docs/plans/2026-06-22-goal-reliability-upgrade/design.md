# Goal Reliability Upgrade Design

Date: 2026-06-22

## Summary

Upgrade the current `pi-goal` implementation into a more mature reliability-focused version while keeping the existing implementation as the base. The current code already has strong continuation safety, budget handling, stale queued work detection, context rewriting, and XML-tagged prompts. This design adds the best ideas from the comparison implementations: Fitch-style recovery and transition discipline, session-journal runtime usage entries, stronger onboarding, tool replacement support, package hygiene, and a lightweight verification gate.

Feature size: **Large**. The later implementation plan should be capped at **7 phases**.

## Goals

- Preserve the current robust goal lifecycle and continuation behavior.
- Improve reliability under goal replacement, compaction, branch replay, provider errors, context overflow, and package installation.
- Make goal creation easier for users and safer for the model by teaching goal objectives as auditable completion contracts.
- Add a transition/effects seam so lifecycle state changes are validated and side effects are localized.
- Add monotonic runtime usage entries to reduce noisy full snapshots and harden replay.
- Add validation scripts and a lightweight smoke gate so package-level regressions are caught earlier.

## Non-goals

- Do not migrate to a file-store persistence model.
- Do not replace current continuation safety with simpler comparison implementations.
- Do not clone Fitch's full many-file module tree.
- Do not implement a rich TUI renderer unless the target Pi TUI API is confirmed compatible and the work is needed for recovery/status clarity.
- Do not weaken current prompt fidelity, XML goal markers, stale queued work protection, budget limits, or no-progress continuation suppression.

## Current baseline

The current implementation in `src/` should remain the base because it already provides:

- Session-journal goal persistence via custom entries.
- Goal statuses: `active`, `paused`, `budget_limited`, `complete`, `cleared`.
- Token budgets and budget-limit steering.
- Hidden continuation prompts with machine-readable goal IDs.
- Generation-based continuation scheduling.
- Stale queued work guard and provider context rewriting.
- No-progress continuation suppression.
- Dynamic `update_goal` tool gating.
- Co-located Vitest coverage.

The comparison implementations contribute useful ideas but should not replace the current base wholesale.

## In-scope changes

### 1. Package and documentation hygiene

Update package metadata and basic project documentation:

- Fix `package.json` description and keywords so they describe `pi-goal`, not the copied hashline editor scaffold.
- Remove unused runtime dependencies if confirmed unused by source and tests.
- Add `typecheck` and `verify` scripts.
- Add a user-facing `README.md` that documents commands, tools, lifecycle states, budget behavior, and continuation behavior.
- Add a minimal `CHANGELOG.md` baseline.

### 2. Goal-writing onboarding bundle

Add user/model-facing guidance so goals are written as completion contracts rather than vague prompts.

Include:

- A packaged goal-writing skill modeled on `Michaelliv-pi-goal/skills/pi-goal-writer/SKILL.md`.
- A `/goal:create` prompt template modeled on `fitchmultz-pi-codex-goal/prompts/create-goal.md` when package prompt support is available.
- Richer `create_goal` descriptions and `promptGuidelines` in `src/tools.ts`.
- Documentation that a strong goal includes:
  1. Outcome.
  2. Verification evidence.
  3. Constraints.
  4. Boundaries.
  5. Iteration policy.
  6. Blocked stop condition.

The prompt template must preserve the user's full intent and must not invent token budgets unless the user explicitly provides one.

### 3. `replace_existing` support for `create_goal`

Extend the model-facing `create_goal` tool with:

```ts
replace_existing?: boolean
```

Behavior:

- If `replace_existing` is absent or false, preserve current duplicate-goal refusal for non-terminal goals.
- If `replace_existing` is true, allow replacing an active, paused, or budget-limited goal only when the user explicitly asked to set a new goal over the current one.
- Replacing a goal must clear pending continuation state, active accounting, stale queued work state, pending completion state, and recovery state.
- Replacement must use the same transition/effects path as command-created replacement so command and tool behavior cannot diverge.

### 4. `/goal copy`

Add a `/goal copy` command that copies the current objective to the clipboard when clipboard support is available.

Behavior:

- If no goal exists, notify the user.
- If clipboard support is unavailable or fails, notify with a clear warning and leave goal state unchanged.
- The command must not schedule continuations, mutate goal lifecycle state, or affect accounting.

### 5. Targeted runtime modules

Refactor runtime orchestration around a small set of deeper modules. `src/index.ts` remains the extension entrypoint, but lifecycle mutation and side effects should move behind explicit seams.

Planned modules:

- `src/runtime-state.ts`
  - Runtime-only mutable state: active accounting, pending continuation, stale-turn flags, recovery state, budget-warning state.
- `src/goal-transition.ts`
  - Pure transition planner returning `{ nextGoal, persist, effects }`.
  - Owns lifecycle and accounting invariants.
- `src/goal-transition-effects.ts`
  - Defines and applies transition effects such as clearing continuation, clearing accounting, resetting recovery, refreshing UI, and syncing tools.
- `src/goal-persistence.ts`
  - Owns current snapshot, last persisted snapshot, full `set`/`clear` entries, and compact runtime `usage` entries.
- `src/goal-accounting.ts`
  - Extracts usage deltas and routes runtime accounting through the transition planner.
- `src/recovery.ts` and `src/recovery-machine.ts`
  - Classifies provider/context-overflow failures and plans `noop`, `pending`, or `pause` recovery actions.

Existing modules remain and become consumers of these seams:

- `src/commands.ts`
- `src/tools.ts`
- `src/prompts.ts`
- `src/format.ts`
- `src/queued-goal-work.ts`
- `src/stale-queued-work-guard.ts`

Design rule: after this refactor, callers should not directly mutate the current goal snapshot. Lifecycle changes go through the transition planner, and runtime side effects go through named effects.

### 6. Transition/effects seam

Introduce a transition planner that centralizes lifecycle rules.

Transition request kinds should cover:

- create or replace goal
- pause
- resume
- clear
- complete
- runtime accounting
- budget-limit crossing
- recovery pause

Transition plans should include:

```ts
type GoalTransitionPlan = {
  nextGoal: GoalState | null;
  persist: "skip" | "set" | "usage" | "clear";
  effects: GoalTransitionEffect[];
};
```

Core invariants:

- Runtime accounting requires a current goal.
- Runtime accounting cannot change the goal ID, objective, token budget, or creation timestamp.
- Usage must never decrease.
- `updatedAt` must not rewind.
- `budget_limited` requires a non-null token budget and `tokensUsed >= tokenBudget`.
- Completing, clearing, pausing, replacing, or budget-limiting a goal clears pending continuation and active accounting.
- Replacing a goal resets recovery and stale queued work state.
- Resuming a goal clears recovery attention and allows continuation scheduling again.

Effects should be explicit and idempotent where possible:

- `clearContinuation`
- `clearActiveAccounting`
- `clearPendingCompletion`
- `clearStaleQueuedWork`
- `resetRecovery`
- `clearBudgetWarning`
- `markContinuationQueued`
- `refreshUi`
- `syncTools`

### 7. Session journal plus runtime usage entries

Keep session custom entries as the source of truth, but extend the entry model beyond full snapshots.

Current entries:

- `set`
- `clear`

New entry:

- `usage`

A runtime usage entry stores monotonic usage/status data for the current goal without echoing the full objective and static metadata every time.

A `usage` entry should include enough data to validate replay safely:

- `goalId`
- `tokensUsed`
- `timeUsedSeconds`
- `turnCount`
- `continuationCount`
- `status` when status is `active` or `budget_limited`
- `updatedAt`
- `at`
- `statusBarEnabled` only if needed for current restore behavior

Replay rules:

- Apply `usage` only when there is a current goal.
- Apply `usage` only when the goal ID matches.
- Apply `usage` only to runtime-usage statuses: `active` or `budget_limited`.
- Ignore entries that decrease tokens, time, turn count, continuation count, or `updatedAt`.
- Ignore `budget_limited` usage unless token budget is non-null and usage is at or over budget.
- Ignore stale or out-of-order usage entries rather than throwing.
- Malformed entries should be skipped consistently with current robust reconstruction behavior.

Persistence rules:

- Semantic lifecycle changes write full `set` or `clear` entries.
- Runtime-only accounting writes `usage` when the last persisted goal has the same goal ID, objective, token budget, and creation timestamp.
- Fall back to full `set` when compact `usage` is not safe.
- Preserve the existing throttled runtime persistence behavior and flush on compact/shutdown.

### 8. Fitch-style recovery

Add a recovery subsystem inspired by `fitchmultz-pi-codex-goal`, adapted to current APIs.

Recovery state should track:

- failure signature
- transient provider attempts
- context-overflow compaction attempts
- recovery attention: `pending` or `paused`
- host/context-overflow user-start gate when needed

Recovery actions:

- `noop`: host/runtime can continue without changing the goal.
- `pending`: recovery is in progress; status should show attention, and continuation may be temporarily blocked depending on phase.
- `pause`: transition goal to paused with a recovery reason and clear continuation/accounting.

Classifications:

- Context overflow increments compaction attempts.
- Repeated context overflow beyond the configured cap pauses the goal.
- Non-retryable provider errors pause the goal.
- Retryable transient provider errors set pending recovery attention.
- Successful assistant turns reset recovery counters and attention.
- User input resets recovery state.
- Clear, replace, complete, and explicit pause reset or clear relevant recovery state.

Status/UI requirements:

- Recovery status must explain what happened.
- It must distinguish pending recovery from paused-for-recovery.
- It must tell the user whether `/goal resume`, another user message, or external action is needed.
- Budget exhaustion remains distinct from recovery pause and completion.

Continuation requirements:

- Continuations must not run while recovery phase says user-start is required.
- Stale queued work protection remains active during recovery.
- Recovery pause must cancel any queued/pending continuation for the affected goal.

### 9. Pi API baseline

It is acceptable to upgrade the Pi peer/API baseline if implementation proves newer APIs are required for prompt packaging, smoke tests, recovery hooks, or clipboard behavior.

The implementation plan should prefer compatibility where practical, but not contort the design to preserve the old `>=0.74.0` baseline if newer APIs materially simplify reliable behavior.

Any API baseline change must be explicit in `package.json`, README, and validation notes.

## Data flows

### Create or replace goal

1. Command or tool receives a goal objective.
2. The objective is normalized and validated.
3. The transition planner receives a create/replace request.
4. The plan clears continuation/accounting/stale/recovery state when goal ID changes.
5. Persistence writes a full `set` entry.
6. UI and active tools refresh.
7. If appropriate and safe, the initial prompt or continuation is queued.

### Runtime accounting

1. Turn/agent end extracts token/time usage.
2. Accounting constructs a proposed next goal state.
3. Transition planner validates monotonic usage and budget crossing.
4. Persistence writes compact `usage` when safe, otherwise full `set`.
5. Budget crossing sends the existing budget-limit steer once for that crossing.
6. UI and tools refresh.

### Recovery

1. Agent end inspects assistant messages for aborted messages, provider errors, and context overflow.
2. Recovery machine updates counters and returns a recovery action.
3. Pending recovery updates status attention and may block continuation.
4. Pause recovery routes through the transition planner and writes a full `set` entry.
5. User input or successful assistant turn resets recovery state as appropriate.

### Restore and replay

1. `restore()` reads current session branch entries.
2. `reconstructGoal()` replays `set`, `usage`, and `clear` entries.
3. Invalid or stale runtime usage entries are ignored.
4. Runtime-only flags such as pending continuation are reset.
5. Tools and status refresh from reconstructed state.

## Error handling

- Duplicate `create_goal` calls remain safe by default.
- `replace_existing` requires explicit true and should be described as user-intent-sensitive in tool guidance.
- Clipboard failures are user-visible warnings and do not mutate goal state.
- Recovery pauses should never mark goals complete.
- Budget-limited goals should not be confused with recovery-paused goals.
- Runtime usage replay should be defensive: skip invalid/stale entries instead of crashing session restore.
- Transition invariant violations during implementation should fail loudly in tests and internal paths; external malformed persisted data should be skipped during reconstruction.

## Testing strategy

Keep the current co-located Vitest style and add focused tests for new seams.

Required tests:

- Package hygiene scripts run successfully.
- `create_goal` rejects duplicate non-terminal goals unless `replace_existing` is true.
- Tool replacement clears pending continuation, stale queued work, active accounting, pending completion, and recovery state.
- Command replacement and tool replacement share the same transition behavior.
- `/goal copy` handles no-goal, success, and clipboard-failure paths.
- Transition planner enforces lifecycle/accounting invariants.
- Runtime usage entries replay only when matching and monotonic.
- Stale/out-of-order usage entries are ignored.
- Budget-limited usage replay requires usage at or above budget.
- Recovery machine classifies retryable transient errors, non-retryable provider errors, and context overflow.
- Recovery pause clears continuation and active accounting.
- Successful assistant turn and user input reset recovery state.
- Continuation scheduling is blocked when recovery requires a user-start turn.
- Existing stale queued work and context rewrite tests continue to pass.

Validation commands:

- `npm test`
- `npm run typecheck`
- `npm run verify`

`npm run verify` should run typecheck, tests, and a lightweight smoke gate.

Smoke gate requirements:

- Check package metadata describes `pi-goal`.
- Check `pi.extensions` points to `./src/index.ts`.
- Check optional `pi.prompts` entries exist if prompt templates are packaged.
- Check extension registration can load in a lightweight mocked host.
- Avoid real provider credentials or slow external-service dependencies.

## Rollout phases for implementation planning

1. **Package hygiene and validation scripts**
   - Fix metadata, dependencies, README, changelog, typecheck, verify skeleton.

2. **Onboarding bundle and tool/command UX**
   - Add goal-writing skill, optional prompt template, richer tool guidance, `replace_existing`, `/goal copy`.

3. **Transition/effects seam**
   - Add transition planner and effect application; route create, replace, pause, resume, clear, complete through it.

4. **Runtime usage persistence and replay hardening**
   - Add `usage` entries, replay guards, persistence fallback logic, and tests.

5. **Recovery machine and status attention**
   - Add provider/context-overflow classification, recovery state, continuation blocking, recovery pause, and UI/status messages.

6. **Runtime integration cleanup**
   - Move remaining mutable runtime state into `runtime-state.ts`; simplify `src/index.ts` orchestration.

7. **Smoke gate and final regression pass**
   - Add smoke validation and run full regression tests.

## Acceptance criteria

The design is implemented when:

- The package metadata and README accurately describe `pi-goal`.
- Users and models have goal-writing guidance that produces auditable completion contracts.
- `create_goal` supports safe explicit replacement with shared command/tool invalidation behavior.
- `/goal copy` works or fails safely without mutating state.
- Lifecycle changes route through transition planning instead of ad hoc direct mutation.
- Runtime usage persistence uses replay-safe compact entries where safe.
- Recovery handles provider errors and context overflow without silently continuing stale or unsafe work.
- Status output explains recovery attention and next user action.
- Existing continuation safety, stale queued work protection, budget behavior, and prompt fidelity are preserved.
- `npm test`, `npm run typecheck`, and `npm run verify` pass.

## Open implementation notes

- Confirm the exact Pi APIs for packaged prompts, clipboard access, and newer event fields before implementation.
- If a Pi API upgrade is needed, update peer dependencies and documentation in the same implementation phase that introduces the dependency.
- Keep the first implementation plan bounded to the seven rollout phases above.
