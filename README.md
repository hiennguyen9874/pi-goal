# pi-goal

Persistent goal tracking for Pi: `/goal` creates one long-running objective, hidden continuations keep work moving, and `update_goal` marks completion only after an evidence-backed audit.

## Commands

| Command | Effect |
|---|---|
| `/goal <objective>` | Create or replace the current goal after confirmation. |
| `/goal <objective> --budget 12k` | Create a goal with a token budget. |
| `/goal` or `/goal status` | Show current goal state. |
| `/goal pause` | Pause automatic continuation. |
| `/goal resume` | Resume a paused goal and clear recovery attention. |
| `/goal clear` | Clear the current goal. |
| `/goal statusbar [on|off]` | Toggle footer status display. |
| `/goal copy` | Copy the current goal objective to the clipboard when supported by the host. |

The package also ships a `/goal:create` prompt template in `prompts/create-goal.md` and a goal-writing skill in `skills/pi-goal-writer/SKILL.md` for drafting auditable completion contracts.

## Lifecycle States

`active`, `paused`, `budget_limited`, `complete`, and `cleared`.

```
active → paused          (user pauses or recovery pauses)
active → budget_limited  (token budget exceeded)
active → complete        (agent calls update_goal after audit)
active → cleared         (user clears)
paused → active          (user resumes)
budget_limited → active  (user resumes)
```

## Model Tools

`get_goal`, `create_goal`, and `update_goal`.

- `get_goal` reads the current goal state.
- `create_goal` creates one active goal from an explicit user request. It accepts `replace_existing: true` only when the user explicitly asked to set a new goal over the current non-terminal one.
- `update_goal` only accepts `status: "complete"` and should be called only after every requirement is verified.

Strong goals should describe the outcome, verification evidence, constraints, boundaries, iteration policy, and blocked stop condition. Do not invent token budgets; set one only when the user provides it.

## Continuations and Safety

pi-goal uses hidden continuation messages to carry work across turns without repeated user prompts. Only one goal is active at a time.

**Continuation scheduling** is generation-based: after a turn finishes, the extension may queue a continuation that prompts the model to resume work. Continuations include the current goal objective, token usage, and audit guidance.

**Stale queued work protection** cancels continuations if the goal was cleared, paused, or changed before the continuation runs. The stale guard rewrites cancelled continuations to a no-op message and aborts the turn.

**No-progress suppression** halts continuations when the previous turn produced no tool calls, preventing infinite retry loops on stuck work.

**Budget-limit steering** transitions the goal to `budget_limited` when `tokensUsed` crosses `tokenBudget` and directs the model to wrap up instead of starting new work.

**Recovery attention** detects provider failures and context-overflow recovery. Pending recovery blocks unsafe automatic continuation until the host recovers, the user sends another message, or `/goal resume` queues the required user-start follow-up after context compaction. Repeated context overflow or non-retryable provider errors pause the goal and tell the user to resume when ready.

**Runtime usage persistence** writes compact replay-safe usage entries for token/time/turn counters when static goal metadata is unchanged, falling back to full snapshots when needed.

**Completion auditing** requires the model to verify every requirement before calling `update_goal`. The continuation prompt reminds the model of this obligation on every turn.

## Development

Run tests:

```bash
npm test
```

Run typecheck:

```bash
npm run typecheck
```

Run package verification:

```bash
npm run verify
```
