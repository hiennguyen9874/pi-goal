# Architecture

Read When: you change goal lifecycle, state transitions, continuation logic, recovery behavior, persistence, or add/remove tools.

## Component Map

```
src/index.ts (extension entrypoint, orchestrator)
  ├── src/commands.ts              /goal command parsing and command UX
  ├── src/tools.ts                 Model tools (get_goal, create_goal, update_goal)
  ├── src/state.ts                 Goal types, entries, reconstruction, basic helpers
  ├── src/runtime-state.ts         Runtime-only mutable state container
  ├── src/goal-transition.ts       Pure lifecycle/accounting transition planner
  ├── src/goal-transition-effects.ts  Runtime side-effect definitions and application
  ├── src/goal-persistence.ts      Full set/clear and compact usage persistence
  ├── src/goal-accounting.ts       Token/time usage extraction helpers
  ├── src/recovery.ts              Provider/context-overflow classification and formatting
  ├── src/recovery-machine.ts      Recovery state machine and continuation blocking
  ├── src/prompts.ts               System and continuation prompt generation
  ├── src/format.ts                Display and tool-result formatting
  ├── src/clipboard.ts             Clipboard adapter for /goal copy
  ├── src/queued-goal-work.ts      Context message rewriting
  ├── src/queued-goal-messages.ts  Message parsing
  └── src/stale-queued-work-guard.ts  Stale continuation detection
```

## Data Flow

1. **Creation/replacement**: User runs `/goal <objective>` or the model calls `create_goal`. Commands confirm replacement; tools require `replace_existing: true` for non-terminal replacement. `index.ts` routes the new goal through `planGoalTransition()` and applies effects that clear stale continuation/accounting/recovery state before persisting a full `set` entry.

2. **Transition planning**: Lifecycle changes (`create`, `pause`, `resume`, `clear`, `complete`, `runtime_accounting`, `recovery_pause`) are planned in `goal-transition.ts`. Plans return `nextGoal`, a persistence mode (`skip`, `set`, `usage`, or `clear`), and named effects. Runtime side effects are applied by `goal-transition-effects.ts`.

3. **Turn end → accounting → continuation**: On message end, `goal-accounting.ts` extracts usage. `applyGoalUsage()` creates a candidate next state, `planGoalTransition()` validates monotonic runtime accounting and budget crossing, and `goal-persistence.ts` writes a compact `usage` entry when safe. `shouldScheduleContinuation()` checks active goal state, tool restrictions, recovery blocking, prior tool-call progress, and pending continuation state before queuing hidden continuation work.

4. **Runtime usage replay**: `state.ts` reconstructs the current goal from session custom entries. Full `set` and `clear` entries remain authoritative. `usage` entries apply only when the goal ID matches, runtime counters and `updatedAt` do not decrease, status is `active` or `budget_limited`, and `budget_limited` usage is at or above the token budget. Invalid, stale, or malformed entries are skipped.

5. **Continuation context guard**: Before a queued continuation runs, `stale-queued-work-guard.ts` checks whether the queued goal ID still matches the current active goal ID. If not, the continuation is rewritten to a stale cancellation marker and the turn is aborted.

6. **Message rewriting**: `queued-goal-work.ts` processes context messages: keeps only the latest continuation per goal ID, rewrites older ones to "superseded" markers, and refreshes the latest with a compact prompt.

7. **Completion**: Model calls `update_goal({ status: "complete" })`. `tools.ts` delegates through the host; `index.ts` plans completion with `planGoalTransition()`, persists a full `set`, and applies effects that clear pending continuation/accounting state.

8. **Budget limit**: On each turn end, accounting can move `tokensUsed` across `tokenBudget`. The transition planner validates that `budget_limited` has a non-null budget and usage at/over budget. Budget-limit status remains distinct from recovery pause and completion.

9. **Recovery**: Assistant/provider errors and session compaction events update `recovery-machine.ts`. Pending recovery sets footer attention and blocks unsafe automatic continuation. Repeated context overflow or non-retryable provider errors plan a `recovery_pause`, which pauses the goal and clears queued/pending runtime work. User input and successful assistant turns reset recovery state where safe.

10. **Clipboard copy**: `/goal copy` uses `clipboard.ts` to copy the current objective when host clipboard support exists. Failures produce warnings and do not mutate goal state or schedule continuations.

## Key Types

- `GoalState` (`state.ts`): versioned goal with objective, status, counters, continuation flags.
- `GoalEntry` (`state.ts`): persisted entry with `action: "set" | "clear" | "usage"`.
- `GoalStatus` (`state.ts`): `"active" | "paused" | "budget_limited" | "complete" | "cleared"`.
- `GoalTransitionPlan` (`goal-transition.ts`): transition result with next state, persistence mode, and effects.
- `GoalTransitionEffect` (`goal-transition-effects.ts`): named runtime side effects such as clearing continuation, accounting, stale queued work, budget warnings, or recovery.
- `GoalRecoveryMachineState` (`recovery-machine.ts`): transient recovery counters and attention state.
- `GoalCommand` (`commands.ts`): discriminated union for CLI actions.
- `GoalToolHost` / `GoalCommandHost`: internal interfaces passed to tools/commands.

## Extension Integration Points

- `registerGoalCommand(pi, host)`: registers `/goal` slash command.
- `registerGoalTools(pi, host)`: registers `get_goal`, `create_goal`, `update_goal` model tools.
- `syncGoalTools(pi)`: dynamically shows/hides `update_goal` based on goal status.
- `persistGoalState(...)`: writes full snapshots or compact usage entries to the session branch.
- `restore(pi, ctx)`: reconstructs goal from session branch on extension load and resets runtime-only state.

## Continuation Suppression Rules

`shouldScheduleContinuation()` returns false when:

- No current goal
- Goal is not `active`
- Continuation already scheduled
- Continuation suppressed (prior hidden turn had no tool calls)
- Tools are restricted
- Recovery blocks continuation
- Plan/read-only mode active (checked externally)

## Stale Work Detection

`StaleQueuedWorkGuard` tracks goal IDs for queued continuation turns. On turn start, if the queued goal ID doesn't match the current active goal (or the goal status isn't active), the turn is flagged stale → accounting cleared, UI refreshed, turn aborted.

## Gotchas

- `tools.ts` only accepts `"complete"` as a valid `update_goal` status. Attempting other values throws.
- `create_goal.replace_existing` should be used only for explicit user replacement intent; otherwise duplicate non-terminal goals are rejected.
- Non-terminal replacement must clear pending continuation, active accounting, stale queued work, pending completion, budget warning, and recovery state.
- The `goalId` for stale continuation messages comes from message `details`, not from the message content.
- Maximum objective length is 4000 characters (`MAX_OBJECTIVE_CHARS`).
- Status spelling is `budget_limited`; do not change it to camelCase.
- Persistence remains session-journal based; do not introduce a file-store persistence model.
