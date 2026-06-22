# Goal Implementation Comparison: Current vs Michaelliv-pi-goal

Both extensions implement the same core idea — a `/goal` command plus model tools that keep Pi working toward a long-running, session-scoped objective until complete/paused/cleared/budget-limited — but they differ substantially in architecture, state model, continuation robustness, prompt design, and packaging.

## 1. Packaging & Extension API

| Aspect | Current (`src/`) | Michaelliv (`.pi/extensions/pi-goal/`) |
|---|---|---|
| Peer dep | `@earendil-works/pi-coding-agent` (≥0.74) | `@mariozechner/pi-coding-agent` + `@mariozechner/pi-tui` |
| Module system | ESM, `type: module` (bundler/tsconfig noEmit) | CommonJS (`"type": "commonjs"`), jiti dev dep |
| Test runner | vitest, co-located `src/*.test.ts` | `node --test test/*.cjs` |
| Entry | `./src/index.ts` | `.pi/extensions/pi-goal/index.ts` |
| Files shipped | `src/` (9 modules) | 3 modules + `skills/` + README + LICENSE |
| Ships a skill | No | Yes — `pi-goal-writer/SKILL.md` (goal-writing guidance) |
| CI | None visible | `.github/workflows/release.yml` |
| Repo extras | `AGENTS.md`, `docs/agent-instructions/` | README poster (`docs/assets/`) |

The two target **different forks of the pi agent API** (`@earendil-works` vs `@mariozechner`), so they aren't drop-in interchangeable — event names, context shapes, and message APIs differ.

## 2. Architecture & Modularity

**Current** is heavily decomposed:
- `state.ts` (types, create/transition/usage/entry/reconstruct/lifecycle checks)
- `commands.ts` (parse + handle `/goal`)
- `tools.ts` (register `get_goal`/`create_goal`/`update_goal`)
- `prompts.ts` (`initPrompt`, `continuationPrompt`, `compactContinuationPrompt`, `budgetLimitPrompt`)
- `format.ts` (token/duration/footer/tool-response formatting)
- `queued-goal-work.ts` + `queued-goal-messages.ts` (context rewriting)
- `stale-queued-work-guard.ts` (stale continuation detection)
- `index.ts` (orchestration, injectable `clock`/`scheduler`)

`createGoalExtension(options)` accepts injectable `clock` and `scheduler`, making the runtime logic testable deterministically.

**Michaelliv** is minimal: `index.ts` (all orchestration, prompts, tools, command, renderer inline), `goal-state.ts` (state + formatting + parse), `usage.ts` (token delta). No dependency injection; uses `Date.now()` and `queueMicrotask` directly.

## 3. State Model

**Current** `GoalState`:
```
status: "active" | "paused" | "budget_limited" | "complete" | "cleared"
goalId: UUID (randomUUID)
+ turnCount, continuationCount,
  lastContinuationHadToolCall, continuationSuppressed, continuationScheduled
```
Persistence uses typed `GoalEntry` with `action: "set" | "clear"` and `reconstructGoal()` replays entries to rebuild state. Rich lifecycle helpers: `canPauseGoal`, `canResumeGoal`, `completeGoalIdempotently`, `isTerminalGoalStatus`.

**Michaelliv** `GoalState`:
```
status: "active" | "paused" | "budget_limited" | "complete"   (no "cleared")
id: `${now}-${random hex}`  (not UUID)
// no turn/continuation counters, no suppression/scheduling flags
```
Persistence appends raw `{ goal, statusBarEnabled }`; `latestStateFromSession()` scans backward for the last custom entry. No set/clear entry distinction — "cleared" is just `goal: null`. `accountGoalTurn` is a one-liner that adds tokens/time and flips to `budget_limited`.

The current version tracks **turn count, continuation count, and no-progress suppression state** that Michaelliv doesn't model at all.

## 4. Continuation Logic (biggest divergence)

**Current** — multi-layered continuation safety:
- `continuationScheduled` flag on the goal + `continuationGeneration`/`pendingContinuationGeneration` counters to invalidate stale scheduled work.
- **No-progress suppression**: if a continuation turn had no tool call (`lastContinuationHadToolCall`), `continuationSuppressed` becomes true and auto-continuation stops with a warning ("no progress detected").
- **Stale queued work guard** (`stale-queued-work-guard.ts`): on `turn_start`, if the queued goal id ≠ current goal id or status isn't active, the turn is aborted (`ctx.abort`) and accounting cleared; on `agent_end` continuation is skipped for stale ids.
- **Context rewriting** (`queued-goal-work.ts`, `pi.on("context")`): rewrites queued continuation messages — supersedes older ones for the current goal with a "ignore this" marker and refreshes the latest with `compactContinuationPrompt`; rewrites stale-goal messages to a cancellation marker. Handles both string-content custom messages and array-content user messages.
- `toolsRestricted` detection on `before_agent_start`: if no `edit`/`write`/`bash` tool is active, continuation is not scheduled (avoids looping with no ability to act).
- `input` handler invalidates continuation when a human message arrives.
- Runtime persistence throttled to every 60s (`runtimePersistIntervalMs`) with `flushRuntimePersistence` on compact/shutdown.
- Handles `session_compact` (restore + flush + re-queue) and `session_tree` (restore on branch switch).

**Michaelliv** — simple single boolean:
- `continuationQueued` flag + `queueMicrotask`; on `agent_end` if goal active and no pending messages, queue one continuation delivered as `followUp`.
- No generation counters, no stale guard, no context rewriting, no no-progress suppression, no tools-restricted check, no `session_compact`/`session_tree`/`input` handlers.
- Continuation message content is the full `continuationPrompt`; delivered via `emitGoalEvent` with `display: true` and rendered as a collapsible "Goal continuing" badge.
- One guard: `persist()` resets `continuationQueued = false` whenever a non-active goal is persisted (covered by a source-contract test).

The current version is built to survive context compaction, goal replacement mid-flight, stale queued turns, and no-op loops; Michaelliv assumes the happy path.

## 5. Prompts

**Current** (`prompts.ts`): four distinct prompts, all XML-marker-tagged and goal-id-aware:
- `initPrompt` — `<pi_goal_init goal_id="...">`, sent as a user message when a new goal is created idle.
- `continuationPrompt` — `<pi_goal_continuation goal_id="...">`, hidden (`display: false`), parsed back via `continuationGoalIdFromMessage` for stale detection.
- `compactContinuationPrompt` — short form used when rewriting the latest queued continuation after compaction.
- `budgetLimitPrompt` — delivered as `steer` when budget crossed.

All wrap the objective in `<untrusted_objective>` with `escapeXmlText`, include a **Fidelity** section ("do not substitute a narrower, safer, smaller solution"), a detailed **Completion audit** (requirement-by-requirement evidence), and budget lines. `continuationGoalIdFromMessage` extracts the goal id from the marker prefix — this is what enables the stale-continuation matching.

**Michaelliv** (inline in `index.ts`): two prompts:
- `continuationPrompt` — used for `active`, `continuation`, and `resumed` events. Shorter completion audit, no XML markers, no goal id, no escape, no Fidelity section. Has the `<untrusted_objective>` wrap and budget lines.
- `budgetLimitPrompt` — similar to current's but shorter.

No `initPrompt` (the "active" event content *is* the continuation prompt), no compact variant. The objective is interpolated raw (no XML escaping).

Both share the same anti-completion-bias philosophy ("treat completion as unproven", "don't accept proxy signals"), but the current version's prompts are markedly more detailed and structurally tagged.

## 6. Tools

Both register the same three tools with the same gating intent, but differ:

| Tool | Current | Michaelliv |
|---|---|---|
| `get_goal` | Always active | Active **only when goal is active** (hidden otherwise) |
| `create_goal` | Always active; **blocks** if a non-terminal goal exists (`duplicate_goal` error) | Always active; **replaces freely** (no duplicate guard) |
| `update_goal` | Active only when goal active; calls `completeGoalIdempotently`, sets `pendingCompletionGoalId` so `turn_end` still accounts the final turn | Active only when goal active; directly sets `status: "complete"` |

Both `update_goal` accept only `status: "complete"`. The current version's `pendingCompletionGoalId` mechanism ensures the completing turn is still token/time-accounted and then transitioned to `complete` in `turn_end` (with a completion notify). Michaelliv notes "final turn usage is accounted by the runtime" but `accountGoalTurn` is only called in `turn_end` and the goal is already `complete` by then, so the final completing turn's usage may not be added (the `accountGoalTurn` path runs regardless of status? No — it runs in `turn_end` but Michaelliv's `turn_end` only accounts when `activeGoalThisTurnId === goal.id` and the goal was active at turn_start; after `update_goal` sets complete mid-turn, the turn_end check `goal.id` still matches but it persists via `accountGoalTurn` which doesn't re-flip status). The current version handles this explicitly with `isCompleting`.

`create_goal` tool descriptions differ: Michaelliv's includes a rich "durable, evidence-checkable work contract" description and 8 `promptGuidelines` encoding the goal-shape template (outcome/verification/constraints/boundaries/iteration/blocked-stop). Current's is sparser (3 guidelines), deferring goal-writing guidance to… nothing (no skill shipped).

`token_budget` param: current uses `token_budget` (snake_case, integer min 1); Michaelliv uses `tokenBudget` (camelCase, number) with `normalizeTokenBudget`.

## 7. Commands (`/goal`)

Both support the same surface: `[/goal]`, `status`, `pause`, `resume`, `clear`, `statusbar [on|off]`, `--tokens`/`--budget` objective, replace-confirm.

Differences:
- **Budget parsing**: current `parseTokenBudget` (`state.ts`) accepts `50k`/`50m` via regex and throws on invalid; command parser accepts `--budget` *or* `--tokens`, with `=` or space. Michaelliv's `parseTokenBudget` (`goal-state.ts`) regex-extracts `--tokens` from the raw arg string only.
- **Replace guard**: current blocks replace if `!ctx.hasUI` (no confirm possible); Michaelliv always confirms via `ctx.ui.confirm`.
- **Lifecycle validation**: current uses `canPauseGoal`/`canResumeGoal` (e.g. "Completed goals are terminal and cannot be paused"); Michaelliv just sets the status directly.
- **Resume**: current calls `scheduleContinuation`; Michaelliv calls `queueContinuation` only if `ctx.isIdle()`.
- **Statusbar**: both toggle/on/off.

## 8. Token Usage Accounting

**Current** `extractTokenUsage` handles a wide spread of field names: `totalTokens`/`total`, `input`/`inputTokens`/`promptTokens`, `output`/`outputTokens`/`completionTokens`, `reasoning`/`reasoningTokens`, `cacheRead`/`cacheWrite` variants. `applyGoalUsage` increments `turnCount`, sets `lastContinuationHadToolCall`/`continuationSuppressed`, and computes `crossedBudget`.

**Michaelliv** `tokenDeltaFromUsage` handles `totalTokens`, or `input+output+cacheRead+cacheWrite` (no reasoning tokens). `accountGoalTurn` adds tokens/time and flips to `budget_limited` if crossed.

## 9. UI / Rendering

**Current**: registers a simple text renderer for `pi-goal-event` messages (`Goal ${kind}: ${objective}`); footer status via `formatFooterStatus` ("Pursuing goal (…)", "Goal paused (/goal resume)", "Goal unmet", "Goal achieved"). Continuation messages are `display: false` (hidden from UI).

**Michaelliv**: richer TUI renderer using `Box`/`Spacer`/`Text` from `@mariozechner/pi-tui` — collapsed badge "Goal ${status} (ctrl+o to expand)"; expanded shows status/objective/usage. Goal events are `display: true` with full prompt content riding as the message content (LLM sees it, UI collapses it). Footer via `statusLine`.

## 10. Tests

**Current**: ~1289 lines of vitest tests across `state`, `commands-tools`, `prompts`, `queued-goal-work`, `stale-queued-work-guard`, and a large `runtime.test.ts` (638 lines) exercising the full event-driven lifecycle with injected clock/scheduler.

**Michaelliv**: ~241 lines — `goal-state.test.cjs` (166), `usage.test.cjs` (23), and two **source-contract** tests (`continuation-contract.test.cjs`, `source-contract.test.cjs`) that regex-match the source text to assert invariants (e.g. "persisting a non-active goal cancels queued continuation"). Lightweight; mostly unit-tests `goal-state.ts` and `usage.ts`, not the orchestration.

## 11. Feature Gap Summary

**Only in current:**
- `cleared` terminal status + set/clear entry replay (`reconstructGoal`)
- Turn count, continuation count, no-progress suppression
- Stale queued work guard (abort stale turns) + context message rewriting (supersede/cancel)
- `compactContinuationPrompt` + compaction-aware re-queue
- `toolsRestricted` detection (no mutating tools → don't continue)
- `input` handler invalidation on human message
- `session_tree` restore on branch switch
- Runtime persistence throttling (60s) + flush hooks
- Injectable clock/scheduler for deterministic tests
- XML-tagged, goal-id-marked, escaped prompts; Fidelity section
- `duplicate_goal` guard on `create_goal` tool
- Explicit final-turn accounting on completion (`pendingCompletionGoalId`)
- Richer token-usage field coverage (reasoning tokens)

**Only in Michaelliv:**
- `pi-goal-writer` skill (structured goal-writing guidance + template)
- Rich expandable TUI renderer (Box/Spacer/Text, ctrl+o)
- Goal events ride full prompt as `display: true` message content
- `create_goal` tool with detailed "work contract" description + 8 prompt guidelines encoding the goal shape
- GitHub release workflow, README poster
- CommonJS package consumable via `pi install npm:pi-goal`

## 12. Net Assessment

- **Current** is the more engineered, robust implementation: it defends against stale continuations, compaction, no-op loops, restricted tools, and mid-flight goal replacement, and is structured for testability. Its prompts are stricter and structurally tagged. It trades complexity (9 modules, ~1300 lines of tests, generation counters, context rewrites) for safety.
- **Michaelliv** is leaner and more user-facing: it ships a goal-writing skill, a polished collapsible TUI, and richer `create_goal` tool guidance that bakes the goal-contract template directly into the model's tool prompt. It assumes the runtime happy path and doesn't defend against stale/compacted/no-progress continuations.

If the goal is **reliability of long autonomous runs under compaction and churn**, the current version is clearly stronger. If the goal is **onboarding users to write good goals and a polished UI**, Michaelliv's skill + renderer are the notable pieces the current version lacks — worth porting the `pi-goal-writer` skill and the expandable renderer into the current codebase.