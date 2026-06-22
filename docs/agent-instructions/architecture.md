# Architecture

Read When: you change goal lifecycle, state transitions, continuation logic, or add/remove tools.

## Component Map

```
src/index.ts (extension entrypoint, orchestrator)
  ├── src/commands.ts        CLI command parsing
  ├── src/state.ts           Goal types, create/transition
  ├── src/tools.ts           Model tools (get_goal, create_goal, update_goal)
  ├── src/prompts.ts         System prompt generation
  ├── src/format.ts          Display formatting
  ├── src/queued-goal-work.ts      Context message rewriting
  ├── src/queued-goal-messages.ts  Message parsing
  └── src/stale-queued-work-guard.ts  Stale continuation detection
```

## Data Flow

1. **Creation**: User runs `/goal <objective>` → `commands.ts` parses → `state.ts` creates `GoalState` → `index.ts` persists via `appendEntry` → `prompts.ts` generates init message → model turn begins.

2. **Turn end → continuation**: On message end, `shouldScheduleContinuation()` checks if goal is active, tools unrestricted, prior continuation had tool calls, no suppression. If eligible, a hidden continuation message is queued → next idle triggers the continuation turn.

3. **Continuation context guard**: Before a queued continuation runs, `stale-queued-work-guard.ts` checks whether the queued goal ID still matches the current active goal ID. If not (goal was cleared/paused), the continuation is rewritten to a stale cancellation marker and the turn is aborted.

4. **Message rewriting**: `queued-goal-work.ts` processes context messages: keeps only the latest continuation per goal ID, rewrites older ones to "superseded" markers, and refreshes the latest with a compact prompt.

5. **Completion**: Model calls `update_goal({ status: "complete" })` → `tools.ts` delegates to `completeGoalIdempotently()` → goal status changes to `complete`.

6. **Budget limit**: On each turn end, `applyGoalUsage()` updates `tokensUsed` and `timeUsedSeconds`. If `tokensUsed >= tokenBudget`, status transitions to `budget_limited`. The next prompt includes budget-limit instructions.

## Key Types

- `GoalState` (`state.ts`): versioned goal with objective, status, counters, continuation flags.
- `GoalEntry` (`state.ts`): persisted entry with `action: "set" | "clear"`.
- `GoalStatus` (`state.ts`): `"active" | "paused" | "budget_limited" | "complete" | "cleared"`.
- `GoalCommand` (`commands.ts`): discriminated union for CLI actions.
- `GoalToolHost` / `GoalCommandHost`: internal interfaces passed to tools/commands.

## Extension Integration Points

- `registerGoalCommand(pi, host)`: registers `/goal` slash command.
- `registerGoalTools(pi, host)`: registers `get_goal`, `create_goal`, `update_goal` model tools.
- `syncGoalTools(pi)`: dynamically shows/hides `update_goal` based on goal status.
- `persist(pi, goal)`: writes goal entry to session branch via `appendEntry`.
- `restore(pi, ctx)`: reconstructs goal from session branch on extension load.

## Continuation Suppression Rules

`shouldScheduleContinuation()` returns false when:
- No current goal
- Goal is not `active`
- Continuation already scheduled
- Continuation suppressed (prior hidden turn had no tool calls)
- Tools are restricted
- Plan/read-only mode active (checked externally)

## Stale Work Detection

`StaleQueuedWorkGuard` tracks goal IDs for queued continuation turns. On turn start, if the queued goal ID doesn't match the current active goal (or the goal status isn't active), the turn is flagged stale → accounting cleared, UI refreshed, turn aborted.

## Gotchas

- `tools.ts` only accepts `"complete"` as a valid `update_goal` status. Attempting other values is a no-op.
- `completeGoalIdempotently()` only marks terminal goals complete. Non-terminal status goals (`paused`, `cleared`, already `complete`) are returned unchanged.
- The `goalId` for stale continuation messages comes from message `details`, not from the message content.
- Maximum objective length is 4000 characters (`MAX_OBJECTIVE_CHARS`).
