# pi-goal

Persistent goal tracking for Pi: `/goal` creates one long-running objective, hidden continuations keep work moving, and `update_goal` marks completion only after an evidence-backed audit.

## Commands

| Command | Effect |
|---|---|
| `/goal <objective>` | Create or replace the current goal after confirmation. |
| `/goal <objective> --budget 12k` | Create a goal with a token budget. |
| `/goal` or `/goal status` | Show current goal state. |
| `/goal pause` | Pause automatic continuation. |
| `/goal resume` | Resume a paused goal. |
| `/goal clear` | Clear the current goal. |
| `/goal statusbar [on|off]` | Toggle footer status display. |
| `/goal copy` | Copy the current goal objective to the clipboard when supported by the host. |

## Lifecycle States

`active`, `paused`, `budget_limited`, `complete`, and `cleared`.

```
active → paused          (user pauses)
active → budget_limited  (token budget exceeded)
active → complete        (agent calls update_goal after audit)
active → cleared         (user clears)
paused → active          (user resumes)
budget_limited → active  (user resumes)
```

## Model Tools

`get_goal`, `create_goal`, and `update_goal`. `update_goal` only accepts `status: "complete"` and should be called only after every requirement is verified.

## Continuations and Safety

pi-goal uses hidden continuation messages to carry work across turns without repeated user prompts. Only one goal is active at a time.

**Continuation scheduling** is generation-based: after a turn finishes, the extension may queue a continuation that prompts the model to resume work. Continuations include the current goal objective, token usage, and audit guidance.

**Stale queued work protection** cancels continuations if the goal was cleared, paused, or changed before the continuation runs. The stale guard rewrites cancelled continuations to a no-op message and aborts the turn.

**No-progress suppression** halts continuations when the previous turn produced no tool calls, preventing infinite retry loops on stuck work.

**Budget-limit steering** transitions the goal to `budget_limited` when `tokensUsed` crosses `tokenBudget` and directs the model to wrap up instead of starting new work.

**Completion auditing** requires the model to verify every requirement before calling `update_goal`. The continuation prompt reminds the model of this obligation on every turn.
