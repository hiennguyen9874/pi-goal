# Overview

Read When: you need domain context about pi-goal, goals, continuations, or how the extension fits into pi.

## Purpose

`pi-goal` lets pi pursue long-running coding objectives across multiple turns without repeated user prompts. A user creates a goal with `/goal <objective>`, the agent works on it visibly, and hidden continuations carry the work forward across turns until the goal is completed, paused, cleared, or hits its token budget.

## Domain Concepts

- **Goal**: a single active objective with status, token budget, usage counters, and continuation state. Only one goal exists at a time.
- **Continuation**: a hidden model-visible message that lets the agent resume work after a turn ends, without the user typing "continue".
- **Budget limit**: when `tokensUsed` crosses `tokenBudget`, the goal becomes `budget_limited` and the model is steered to wrap up instead of starting new work.
- **Stale queued work**: if a continuation is queued but the goal was cleared or paused before it ran, the stale guard rewrites the continuation to a no-op cancellation message and aborts the turn.

## Goal Lifecycle States

```
active → paused (user pauses)
active → budget_limited (token budget exceeded)
active → complete (agent calls update_goal after audit)
active → cleared (user clears)
paused → active (user resumes)
budget_limited → active (user resumes)
```

## User-Facing Commands

| Command | Effect |
|---|---|
| `/goal <objective>` | Create or replace goal, start first visible turn |
| `/goal <objective> --budget 12k` | Create with token budget |
| `/goal` or `/goal status` | Show current goal state |
| `/goal pause` | Pause automatic continuation |
| `/goal resume` | Resume hidden continuation on idle |
| `/goal clear` | Clear current goal |

## Model Tools

- `get_goal` — read current goal state (works when no goal exists too)
- `create_goal` — create a goal from an explicit model-detected user request
- `update_goal` — mark goal `complete` (only accepted status value)
