# pi-goal: Current version vs `code-yeongyu-pi-goal`

Both are pi extensions that port a Codex-style "goal mode" into pi: a persistent objective, hidden continuation prompts, token/time accounting, model-facing tools, and a TUI footer. They share the same conceptual DNA but diverge sharply in **storage model, state machine, continuation/stale-work handling, and prompt richness**. The current version is materially more sophisticated.

## 1. Distribution & packaging

| Aspect | Current (`src/`) | `code-yeongyu-pi-goal` |
|---|---|---|
| pi peer deps | `@earendil-works/pi-*` (earendil fork) | `@mariozechner/pi-*` (mariozechner/senpi fork) |
| Type schema lib | `@sinclair/typebox` (referenced) | `typebox` (direct import, `Type.Object`) |
| Tooling | vitest only | vitest + biome + `tsgo` + custom `no-excuse` checker |
| Linting | none configured | biome (`lint`, `lint:fix`, `check`) |
| Module style | `.ts` imports, no `"type": "module"` | `"type": "module"`, `.js` import specifiers |
| package.json description | ⚠️ Copy-paste error: *"Focused merged hashline editor…"* (leftover from pi-hashline-edit) | Accurate: *"Persistent goal tracking for pi-coding-agent…"* |
| Version | `0.1.0` | `0.2.0` |

Note: the current `package.json` description/keywords are wrong (hashline-editor residue) even though the source is genuine pi-goal code. `code-yeongyu`'s metadata is clean and includes a `SKILL.md` and README.

## 2. Architecture & storage model — the biggest difference

**Current — in-memory state reconstructed from session entries.**
- `state.ts` defines `GoalState` plus a `GoalEntry` journal (`action: "set" | "clear"`).
- State lives in `currentGoal`/`lastPersistedGoal` in the closure; persistence is via `pi.appendEntry(ENTRY_TYPE, …)` — i.e. goal state is **embedded in the session branch** as custom entries.
- `reconstructGoal(branch)` replays entries to rebuild state on `session_start`/`session_tree`/`session_compact`.
- Has **runtime throttled persistence** (`runtimePersistIntervalMs = 60_000`) and `flushRuntimePersistence` on compact/shutdown.
- `goalsEquivalent` avoids writing no-op entries.

**code-yeongyu — file-based store keyed by thread id.**
- `store.ts` reads/writes a JSON file at `goalStoreRef`: `<sessionDir>/extensions/pi-goal/<encodeURIComponent(threadId)>.json` (or a `~/.pi/agent/extensions/pi-goal/<cwdHash>` fallback when no session file).
- Every operation (`createGoal`, `updateGoal`, `clearGoal`, `accountGoalUsage`) does `readGoal` → mutate → `writeGoal`.
- No in-memory cache; each handler re-reads from disk.
- Has typed store errors (`GoalAlreadyExistsError`, `GoalNotFoundError`, `InvalidGoalStoreError`, `UnsupportedGoalStoreVersionError`) and validates the file schema on load (`isGoal`).

**Tradeoff:** code-yeongyu's file store is simpler to reason about and survives independently of the session journal, but every event pays disk I/O and there's no coalescing. The current version ties state to the session branch (so branching/compaction semantics come for free) and is faster, at the cost of a more complex restore/reconstruct path and the `lastPersistedGoal` equivalence logic.

## 3. State model & statuses

| Field | Current `GoalState` | code-yeongyu `Goal` |
|---|---|---|
| Statuses | `active`, `paused`, **`budget_limited`**, `complete`, `cleared` (5) | `active`, `paused`, `complete` (3) |
| `tokenBudget` | ✅ stored on goal | ❌ absent |
| `tokensUsed` | ✅ | ✅ |
| `timeUsedSeconds` | ✅ | ✅ (seconds, `Math.trunc(Date.now()/1000)`) |
| `turnCount` | ✅ | ❌ |
| `continuationCount` | ✅ | ❌ |
| `lastContinuationHadToolCall` | ✅ | ❌ |
| `continuationSuppressed` | ✅ | ❌ |
| `continuationScheduled` | ✅ | ❌ |
| `lastStartedAt` / `completedAt` | ❌ | ✅ |
| `threadId` on goal | ❌ (implicit) | ✅ |
| Time units | **milliseconds** (`Date.now()`) | **seconds** (`nowSeconds`) |

Key conceptual gaps in code-yeongyu:
- **No token budget / `budget_limited` status.** The README and `SKILL.md` *claim* a `budgetLimited` status and `token_budget` parameter, but the actual `types.ts`/`store.ts`/tool definitions do **not** implement them. This is a docs-vs-code drift worth flagging.
- **No continuation progress tracking.** Current tracks `lastContinuationHadToolCall` and sets `continuationSuppressed` when a continuation turn made no tool call — enabling a "no progress detected, pause continuation" behavior. code-yeongyu has nothing equivalent and will keep queueing continuations indefinitely regardless of progress.

## 4. Tools

Both register the same three tools, but with different schemas and guards.

| Tool | Current | code-yeongyu |
|---|---|---|
| `get_goal` | empty params; returns `goalToolText(goal)` JSON with `goal`, `remainingTokens`, `completionBudgetReport` | empty params; returns `formatGoalToolResponse` JSON with `goal` snapshot |
| `create_goal` | params `{objective, token_budget?}`; refuses if a **non-terminal** goal exists (allows overwrite when `complete`/`cleared`) | params `{objective}` **only** (no budget); throws if *any* goal exists |
| `update_goal` | `{status: "complete"}` only; calls `completeGoalIdempotently` (idempotent on already-complete) | `{status: union of COMPLETABLE statuses}` = `"complete"`; throws if status ≠ complete |

Notable current-only tooling features:
- `promptSnippet` and `promptGuidelines` fields on each registered tool (richer model-facing guidance).
- **Dynamic tool gating via `syncGoalTools`**: `update_goal` is only added to the active tool set when a goal is `active`; otherwise removed. `get_goal`/`create_goal` are always present. code-yeongyu registers all three statically and never toggles them.
- `create_goal` distinguishes "non-terminal goal exists" (refuse) from terminal (allow replace), which is more lenient than code-yeongyu's hard refusal.

## 5. `/goal` command

| Feature | Current | code-yeongyu |
|---|---|---|
| Subcommands | `status`, `pause`, `resume`, `clear`, `create <obj>`, `statusbar`, `statusbar on/off` | `show` (empty), `pause`, `resume`, `clear`, `setObjective <obj>` |
| Token budget flag | ✅ `--budget=N` / `--tokens N` on create | ❌ |
| Argument completions | ✅ `getArgumentCompletions` for subcommands | ❌ |
| Status bar toggle | ✅ `/goal statusbar [on|off|toggle]` persists `statusBarEnabled` in entries | ❌ |
| Replace-goal confirm | `ctx.ui.confirm("Replace goal?", …)` | `ctx.ui.select(...)` with explicit Replace/Cancel choices |
| Pause/resume guards | `canPauseGoal`/`canResumeGoal` lifecycle checks (e.g. "Completed goals are terminal") | Direct `updateGoal({status})`, no pre-check |
| Init prompt on new goal | ✅ sends `initPrompt(goal)` as a user message when idle | ❌ (only continuation prompts) |
| Goal event messages | ✅ `pi-goal-event` custom messages (created/paused/resumed/cleared/completed) with a registered renderer | ❌ |

## 6. Prompts — the most striking qualitative difference

Both wrap the objective as `<untrusted_objective>` (XML-escaped) and frame it as user data, not higher-priority instructions. Both include a "completion audit" section. But the current version's prompts are far more elaborate and have **multiple prompt types**, while code-yeongyu has a single continuation prompt.

**Current `prompts.ts` produces four distinct prompts:**
1. `initPrompt` — sent as a *user* message when a new goal is created and idle. Lengthy sections: Goal behavior, Budget, Work from evidence, Fidelity, Completion audit. Emphasizes "do not shrink the objective to what fits now" and "do not substitute a narrower/safer/easier solution."
2. `continuationPrompt` — hidden continuation, marked with `<pi_goal_continuation goal_id="…">` so the goal id is machine-parseable. Repeats the full audit + fidelity guidance plus "Avoid repeating work that is already done."
3. `compactContinuationPrompt` — a trimmed version used when rewriting queued messages during `context` events (after compaction), preserving the marker + budget + audit essentials.
4. `budgetLimitPrompt` — sent as a `steer` when the token budget is crossed: "do not start new substantive work… wrap up this turn… do not call update_goal unless actually complete."

It also embeds **budget lines** (time used, tokens used, budget, remaining) in every prompt, and exposes `continuationGoalIdFromMessage` to parse the marker back out — used by the stale-work guard.

**code-yeongyu `prompt.ts` has one prompt:** `buildContinuationPrompt(goal)`. It covers objective-as-untrusted-data, usage so far (time + raw token count, no budget), "avoid repeating work," and a completion audit. There is no init prompt, no budget-limit prompt, no compact variant, no machine-readable goal-id marker. The audit guidance is detailed but the "fidelity / don't-shrink-the-objective" framing present in the current version is missing.

## 7. Continuation scheduling & stale-work handling

This is where the current version is dramatically more mature.

**code-yeongyu** (`continuation.ts` + index handlers):
- Two pure predicates: `shouldQueueGoalContinuationWhenIdle(goal, isIdle, hasPendingMessages)` and `shouldQueueGoalContinuationAfterAgentEnd(goal, hasPendingMessages)`.
- Queues a hidden continuation via `pi.sendMessage({customType, content, display:false}, {triggerTurn:true, deliverAs:"followUp"})`.
- No generation counter, no pending-continuation state, no stale detection. If a goal is replaced/paused/cleared while a queued continuation is pending, that continuation can still fire.

**Current** (`index.ts` + `stale-queued-work-guard.ts` + `queued-goal-work.ts` + `queued-goal-messages.ts`):
- A `continuationGeneration` counter and `pendingContinuation*` slots track the *single* in-flight continuation; `invalidateContinuation()` bumps the generation on user input, clear, replace, or session tree changes — so a scheduled `scheduler(() => …)` callback checks `generation !== pendingContinuationGeneration` and bails if superseded.
- `shouldScheduleContinuation` checks `active`, not already scheduled, not suppressed, and **not `toolsRestricted`** (a guard: if the active tool set has no mutating tool — `edit`/`write`/`bash` — continuations are suppressed, computed in `before_agent_start`).
- `schedulePendingContinuation` only fires when `ctx.isIdle()` and `!ctx.hasPendingMessages()` — re-checked *inside* the scheduled callback, not just at queue time.
- `awaitingContinuationGoalId` lets `turn_start` know whether the incoming turn is a continuation (used to set `wasContinuation` for the suppression logic).
- **Stale-queued-work guard** (`createStaleQueuedWorkGuard`): `planTurnStart` decides whether a queued continuation whose `goalId` ≠ current goal (or current status ≠ active) is *stale*; if so it returns effects `clearAccounting` + `refreshUi` + `abort` (calling `ctx.abort?.()`), and `planAgentEnd` later skips re-queuing for that goal id.
- **Context-message rewriting** (`applyQueuedGoalProviderContextRewrites`, hooked on the `context` event): walks provider messages, finds continuation markers, and for the *current* goal supersedes all-but-latest (rewriting older ones to a "superseded hidden bookkeeping message — ignore" marker) and refreshes the latest with `compactContinuationPrompt`. For *non-current* goal ids it rewrites to a "stale and cancelled" marker. This prevents stale continuations from polluting the model's context after compaction or branching.
- Reload behavior: on `session_start` with `reason === "reload"`, an active goal is auto-paused with a notify ("Goal paused after reload… Use /goal resume to continue."). code-yeongyu instead *prompts to resume* a paused goal on session start via `maybePromptResumePausedGoal` (a `ui.select` Resume/Leave-paused), gated on `reason === "resume"`.

Net: the current version treats queued continuations as a concurrency hazard and actively defends against stale/duplicate/superseded ones across turn boundaries, compaction, and reload. code-yeongyu queues continuations optimistically with no staleness defense.

## 8. Token / time accounting

| Aspect | Current | code-yeongyu |
|---|---|---|
| Where accounted | `turn_end` via `applyGoalUsage` | `agent_end` / `accountCurrentAgentTurn` |
| Usage extraction | `extractTokenUsage(event.message)` — handles `usage`/`metadata.usage`/`tokens` and sums input+output+reasoning+cacheRead+cacheWrite (or `totalTokens`/`total` if present) | `collectAssistantUsage(event.messages)` — sums `input` + `output` (+cache fields stored but `goalTokenDeltaForUsage` only uses input+output) |
| Elapsed time | `clock() - activeTurnStartedAt` (ms, /1000) | `Date.now() - agentGoalAccounting.measuredFromMilliseconds` (re-anchored each account) |
| Budget crossing | ✅ `crossedBudget` → status `budget_limited` + `budgetLimitPrompt` steer | ❌ no budget concept |
| Per-turn metadata | tracks `hadToolCall`, `wasContinuation` → drives `continuationSuppressed` | ❌ |
| Mode | always for active goal | `GoalAccountingMode` `"active"` vs `"activeOrComplete"` (so a goal completed mid-turn still gets the final turn's usage) |

code-yeongyu's `activeOrComplete` mode is a nice touch the current version approximates via `pendingCompletionGoalId` (when `update_goal` completed this turn, `turn_end` still accounts the turn before transitioning to `complete`). code-yeongyu's `agentGoalAccounting` re-anchors `measuredFromMilliseconds` after each accounting call, which is cleaner than the current `activeTurnStartedAt` (which resets per turn but is only set in `turn_start`).

## 9. TUI / footer

- **Current** (`format.ts` `formatFooterStatus`): rich states — `Pursuing goal (Xm)`, `Pursuing goal (tokens / budget)`, `Goal paused (/goal resume)`, `Goal unmet (...)` (budget_limited), `Goal achieved (...)`. Toggleable via `/goal statusbar` and persisted in entries. Uses `ctx.ui.setStatus("pi-goal", …)`.
- **code-yeongyu** (`ui.ts`): `Pursuing goal (Xs)`, `Goal paused (/goal resume)`, `Goal achieved`. No budget/unmet states, no toggle. Uses `ctx.ui.setStatus("goal", …)`. Has a `updateGoalUiBestEffort` wrapper that swallows the "stale extension ctx" error.

## 10. Lifecycle hooks used

| Event | Current | code-yeongyu |
|---|---|---|
| `session_start` | restore; auto-pause on reload | read; maybe prompt resume; queue continuation if idle |
| `session_tree` | restore (branch switch) | — |
| `session_compact` | restore + flush + ensure continuation | — |
| `before_agent_start` | compute `toolsRestricted` | — |
| `agent_start` | — | set `agentTurnInProgress`, begin accounting |
| `turn_start` | set `activeTurnStartedAt`, run stale guard, detect continuation | — |
| `turn_end` | account usage, budget crossing, completion, notify | — |
| `agent_end` | stale-guard plan + ensure continuation | account usage + queue continuation |
| `tool_execution_end` | set `currentTurnHadToolCall` | — |
| `input` | invalidate continuation on human input | — |
| `context` | rewrite queued continuation messages | — |
| `session_shutdown` | flush + invalidate | final account |

The current version uses ~10 hooks; code-yeongyu uses 4 (`session_start`, `agent_start`, `agent_end`, `session_shutdown`). The richer hook usage is what enables the current version's progress-detection, stale-defense, and compaction-safety behaviors.

## 11. Testing

- **Current**: co-located `src/*.test.ts` — `runtime.test.ts` (46 tests) is the heavy one, plus `state`, `commands-tools`, `prompts`, `queued-goal-work`, `stale-queued-work-guard`. ~97 test entries total, focused on lifecycle and the stale/superseded logic.
- **code-yeongyu**: separate `test/` dir — `extension.test.ts` (22KB, the bulk), `store.test.ts`, `command`, `continuation`, `format`, `prompt`, `ui`, `validation`. Covers the file store and parsing more directly.

## 12. Notable discrepancies & risks

1. **code-yeongyu docs overpromise.** README + `SKILL.md` advertise `budgetLimited` status, `token_budget` param, and "Goal unmet (...)" footer — none exist in `types.ts`/`store.ts`/the tools. The current version actually implements all of these.
2. **Current `package.json` metadata is wrong** — description and keywords are hashline-editor leftovers. Should be fixed.
3. **code-yeongyu has no continuation staleness defense** — a replaced/paused goal can still trigger a queued continuation turn. The current version's guard + context rewrites are the main reason it's the more production-ready of the two.
4. **code-yeongyu has no progress suppression** — it will loop continuations forever even if the model makes no tool calls. Current sets `continuationSuppressed` and notifies the user.
5. **Time units differ** (ms vs s) — relevant only if porting data between them.
6. **Different pi distributions** — they're not drop-in interchangeable; each targets a different fork (`@earendil-works` vs `@mariozechner`) and a different typebox import style.

## Summary

- **code-yeongyu-pi-goal** is the cleaner, smaller, file-store-based baseline: three statuses, three static tools, one continuation prompt, optimistic scheduling, README + SKILL docs, biome/tsgo tooling. Good scaffold; under-built on safety and feature-complete only for the basic active/paused/complete cycle.
- **The current version** is a significantly more advanced evolution: session-embedded state with throttled persistence, token budgets + `budget_limited` + budget-limit steer, dynamic tool gating, four rich prompt types with machine-readable markers, generation-tracked continuation scheduling, a stale-queued-work guard, context-message rewriting for compaction/branch safety, progress-based continuation suppression, status-bar toggle, goal event messages, and reload-auto-pause. Its weaknesses are the wrong `package.json` metadata and the absence of lint/typecheck scripts that code-yeongyu has.

If the goal is to converge them, the clearest wins from code-yeongyu to bring into the current version are: the typed store-error classes, the `agentGoalAccounting` re-anchoring pattern, the `activeOrComplete` accounting mode (cleaner than `pendingCompletionGoalId`), biome/tsgo CI, and a README/SKILL.md (the current repo has only `docs/agent-instructions/`).