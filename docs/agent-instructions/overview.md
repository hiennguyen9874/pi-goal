# Overview

Read When: you need domain context about pi-goal, goals, continuations, or how the extension fits into pi.

## Purpose

`pi-goal` lets pi pursue long-running coding objectives across multiple turns without repeated user prompts. A user creates a goal with `/goal <objective>`, the agent works on it visibly, and hidden continuations carry the work forward across turns until the goal is completed, paused, cleared, paused for recovery, or hits its token budget.

## Domain Concepts

- **Goal**: a single active objective with status, token budget, usage counters, and continuation state. Only one goal exists at a time.
- **Completion contract**: the preferred goal shape: outcome, verification evidence, constraints, boundaries, iteration policy, and blocked stop condition.
- **Continuation**: a hidden model-visible message that lets the agent resume work after a turn ends, without the user typing "continue".
- **Budget limit**: when `tokensUsed` crosses `tokenBudget`, the goal becomes `budget_limited` and the model is steered to wrap up instead of starting new work.
- **Stale queued work**: if a continuation is queued but the goal was cleared, paused, or replaced before it ran, the stale guard rewrites the continuation to a no-op cancellation message and aborts the turn.
- **Recovery attention**: provider errors and context overflow can set pending recovery attention, block automatic continuations, or pause the goal with an explanatory status.
- **Runtime usage entries**: compact session-journal entries that replay token/time/turn counters when they are monotonic and match the current goal.

## Goal Lifecycle States

```
active → paused (user pauses or recovery pauses)
active → budget_limited (token budget exceeded)
active → complete (agent calls update_goal after audit)
active → cleared (user clears)
paused → active (user resumes)
budget_limited → active (user resumes)
```

## User-Facing Commands

| Command | Effect |
|---|---|
| `/goal <objective>` | Create or replace goal after confirmation, then start the first visible turn |
| `/goal <objective> --budget 12k` | Create with token budget |
| `/goal` or `/goal status` | Show current goal state |
| `/goal pause` | Pause automatic continuation |
| `/goal resume` | Resume hidden continuation on idle and clear recovery attention |
| `/goal clear` | Clear current goal |
| `/goal copy` | Copy the current objective to the clipboard when host support is available |
| `/goal statusbar [on|off]` | Toggle footer status display |

## Model Tools

- `get_goal` — read current goal state (works when no goal exists too)
- `create_goal` — create a goal from an explicit model-detected user request; `replace_existing: true` is allowed only when the user explicitly asked to replace the current non-terminal goal
- `update_goal` — mark goal `complete` (only accepted status value) after a strict completion audit

## Packaged Guidance

- `skills/pi-goal-writer/SKILL.md` helps draft auditable completion-contract objectives.
- `prompts/create-goal.md` provides a `/goal:create` prompt template for converting user intent into a safe goal without inventing token budgets.
