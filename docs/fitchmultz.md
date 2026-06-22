# pi-goal: current workspace vs `fitchmultz-pi-codex-goal`

Two implementations of the same idea — a pi extension that gives the agent a durable, budget-tracked "goal" with hidden self-continuations and a completion audit. They share the domain concept but diverge sharply in architecture, feature surface, and maturity.

**At a glance**

| | Current (`pi-goal`, workspace) | `fitchmultz-pi-codex-goal` |
|---|---|---|
| Package / version | `pi-goal` `0.1.0` (note: `package.json` `description`/`keywords` are stale leftovers from a "hashline editor" project — the actual `src/` is the goal extension) | `pi-codex-goal` `0.1.27`, actively shipped |
| Entry | `src/index.ts` — one ~520-line `createGoalExtension()` factory that wires everything inline | `src/index.ts` (8 lines) → `goal-runtime-controller.ts` composing ~15 focused modules |
| Source files | 12 (`src/*.ts`, co-located tests) | ~37 `src/*.ts` + `prompts/` + `scripts/` + `docs/` |
| Tests | co-located `*.test.ts` | `test/` dir, 302 tests + separate `check:platform-smoke` gate |
| Peer baseline | `@earendil-works/* >=0.74.0` | `>=0.79.x`, uses `@earendil-works/pi-ai` `StringEnum`/`typebox` |
| Naming | "pi-goal", statuses `active | paused | budget_limited | complete | cleared` | "Codex-style goal" / "thread goal", statuses `active | paused | budgetLimited | complete` (no `cleared`) |

---

## 1. Architecture & wiring

**Current — monolithic factory.** `src/index.ts` holds *all* runtime state as closure variables (`currentGoal`, `continuationGeneration`, `pendingContinuationGoalId`, `toolsRestricted`, `currentTurnQueuedGoalId`, the stale-queued-work guard, etc.) and registers every pi event handler (`session_start`, `turn_start`, `turn_end`, `agent_end`, `input`, `context`, `before_agent_start`, `tool_execution_end`, `session_compact`, `session_tree`, `session_shutdown`) inline. Tools and the `/goal` command are registered with callbacks that mutate those closures. `state.ts` is pure domain logic; `prompts.ts`/`format.ts`/`tools.ts`/`commands.ts` are thin. This is readable and self-contained but state and behavior are inseparable.

**Fitch — decomposed runtime.** `index.ts` just calls `registerGoalRuntimeController(pi)`. That controller (`goal-runtime-controller.ts`) composes:
- `goal-runtime-state.ts` (mutable runtime state object)
- `goal-persistence.ts` (goal get/restore/persist)
- `goal-runtime-status.ts` (status bar / UI refresh, with stop control)
- `continuation-scheduler.ts` (continuation queueing)
- `goal-state-controller.ts` + `goal-transition.ts` + `goal-transition-effects.ts` (a *transition planner* that returns `beforePersist`/`afterPersist` effect lists)
- `goal-accounting.ts` (token/time accounting)
- `recovery-runtime.ts` + `recovery-machine.ts` + `recovery-phase.ts` + `recovery-adapters.ts` + `recovery.ts` (provider-error / context-overflow recovery state machine)
- `stale-queued-work-*.ts` (7 files: reducer, obligations, types, terminal-cleanup, reducer-defaults, guard)
- `goal-runtime-*-handlers.ts` (turn/session/input/context/agent handlers split per concern)
- `runtime-config.ts` (`__testHooks`), `clipboard.ts`, `types.ts`

The defining difference: **fitch routes every state mutation through `planGoalTransition()`**, which returns a declarative plan (`persist: "skip" | "defer" | "set" | "clear"` + effect lists) validated by invariant guards (`requireSameGoalId`, `requireNonDecreasingUsage`, `requireBudgetLimitedUsageAtOrOverBudget`, `requireNonRewindingUpdatedAt`, …). The current version mutates `currentGoal` directly and persists opportunistically.

---

## 2. State model & persistence

**Current (`state.ts`):** `GoalState` is a flat struct with scalar counters:
```
tokensUsed, timeUsedSeconds, turnCount, continuationCount,
lastContinuationHadToolCall, continuationSuppressed, continuationScheduled
```
Persistence entries are `action: "set" | "clear"` only. `reconstructGoal` replays set/clear. Time is in **ms** (`clock()` → `Date.now()`). There is a `runtimePersistIntervalMs = 60_000` throttle and a `flushRuntimePersistence` on compact/shutdown. `statusBarEnabled` rides on the entry.

**Fitch (`state.ts` + `types.ts`):** `ThreadGoal` nests `usage: { tokensUsed, activeSeconds }`. It drops `turnCount`, `continuationCount`, `lastContinuationHadToolCall`, `continuationSuppressed`, `continuationScheduled` from the persisted shape — those are runtime-only concerns. Time is in **unix seconds**. Persistence has *three* entry kinds: `set`, `usage` (a runtime-usage delta entry that's only valid for `active`/`budgetLimited` goals, with monotonic guards), and `clear`, plus a fourth `host_overflow_cap_reset` entry. `reconstructGoal` enforces `canApplyRuntimeUsageEntry` (matching goalId, non-decreasing usage, `updatedAt` not older, no `budgetLimited→active` rewind) before applying a usage entry — so out-of-order or stale usage entries are silently dropped rather than corrupting state. There's also `goalWithLiveUsage()` that adds elapsed seconds since `lastAccountedAt` for display, and `reconstructHostOverflowCapNeedsUserReset()`.

So fitch's persistence is append-friendly for runtime usage (compact entries that don't require echoing the whole goal) and explicitly defends against replay hazards; the current version only ever writes full-goal snapshots.

---

## 3. Features

Features in **fitch not present in current**:
- **Error recovery state machine** (`recovery-machine.ts`): tracks `transientAttempts`, `compactionAttempts`, `failureSignature`; on context-overflow it increments compaction attempts and pauses with attention after `MAX_CONTEXT_COMPACTION_RETRIES`; on non-retryable provider errors it pauses immediately; on retryable transient errors it goes "pending". Has `RecoveryAttention` (pending vs paused) surfaced through status. The current version has no provider-error handling at all.
- **Host context-overflow recovery + user-reset gate**: `host_overflow_cap_reset` persistence, `requireHostOverflowUserReset`, `beginHostOverflowRecovery`, `recoveryPhaseNeedsUserStartTurn`, and a `GoalStartTurnStrategy` (`userFollowUp` vs queued turn) that the command layer consults. The 0.1.26 changelog: "Resume active goals after host context-overflow auto-compaction… avoiding sessions that only continue again after `/reload`."
- **`/goal copy`** command — copies the objective to the clipboard via a `clipboard.ts` adapter (`copyTextToClipboard`).
- **`create_goal` `replace_existing` parameter** — lets the model replace an active/paused/budget-limited goal without a `/goal clear`; current version returns an error for duplicate goals and only the command path confirms a replace.
- **`prompts/create-goal.md`** — a pi slash-prompt template (`/goal:create <task>`) that converts a plain task into a strict evidence-based objective contract and calls the creation tool. Current version has no prompt templates.
- **Tool-name namespasing guidance** (`GOAL_TOOL_NAME_GUIDANCE`, `goalToolReference`) so the prompts work under bridged MCP (`pi__get_goal`). Current version assumes bare names.
- **`compactContinuationPrompt`** used as a user-follow-up after resume/start (fitch uses `deliverAs: "followUp"`; current uses `triggerTurn` continuation messages and a separate compact-on-`session_compact` path).
- **Transition invariants / effect handler abstraction** (`goal-transition-effects.ts`, `GoalTransitionEffectHandlers`): `clearContinuation`, `clearActiveAccounting`, `resetRecovery`, `clearBudgetWarning`, `clearHostOverflowRecovery`, `setRecoveryPausedAttention`, `markContinuationQueued`, `stopStatusRefresh`.
- **Platform-smoke test harness** (`scripts/platform-smoke.mjs`, `platform-smoke.config.mjs`, `check:platform-smoke`) validating packed-package install + model-backed runtime behavior. Current version has only unit tests.
- **`__testHooks`** export from `runtime-config.ts` for test injection.

Features in **current not present in fitch** (or implemented differently):
- **`/goal statusbar [on|off|toggle]`** command + `statusBarEnabled` persisted on entries + `setStatusBar` host method. Fitch's status module has no user-facing toggle.
- **`status: "cleared"`** as an explicit terminal status (fitch just nulls the goal).
- **`/goal status`** subcommand that dumps `formatFooterStatus` + `goalToolText` (fitch's bare `/goal` shows `formatGoalSummary`).
- **`/goal <objective> --budget=…` / `--tokens …`** CLI flag parsing (`parseTokenBudget` with `k`/`m` suffixes). Fitch's `/goal <objective>` takes the whole arg as the objective and does **no** budget parsing from the command line — budgets only come via the tool's `token_budget` param.
- **`goalsEquivalent` includes the full scalar set** (turn/continuation counts, suppression flags); fitch's equivalence is narrower (id, objective, status, budget, timestamps, usage).
- **`emitGoalEvent`** renderer (`pi-goal-event` custom messages with a registered message renderer showing "Goal created/paused/resumed/cleared/completed: <objective>"). Fitch has no equivalent visible event renderer.
- **Reload-pause behavior**: on `session_start` with `reason === "reload"` and an active goal, current auto-pauses and notifies "Use /goal resume to continue." Fitch instead has the host-overflow recovery path to *resume* after compaction.
- **`before_agent_start` tools-restricted detection**: current inspects whether mutating tools (`edit`/`write`/`bash`) are active and gates continuation scheduling on `toolsRestricted`. Fitch's continuation logic is in `continuation-scheduler.ts` and consults recovery phase / stale guard instead.
- **`budget_limited` continuation steering**: on `turn_end` budget crossing, current sends a `budget_limit` prompt as a `steer` turn and notifies the user. Fitch has an analogous `budgetLimitPrompt` but the transition effect (`clearBudgetWarning`, `markContinuationQueued`) and accounting path differ.

---

## 4. Prompts

**Current (`prompts.ts`)** — four prompts:
- `initPrompt(goal)` — the long `<pi_goal_init>` block: persistence-across-turns, fidelity rules ("do not substitute a narrower, safer, smaller… solution"), an explicit **Completion audit** section (derive requirements → map each to authoritative evidence → classify prove/contradict/incomplete/weak/missing → match verification scope → treat uncertain as not achieved), budget lines, and a directive to call `update_goal` and report final time/budget.
- `continuationPrompt(goal)` — nearly identical content under `<pi_goal_continuation goal_id="…">` with an added "Avoid repeating work that is already done" line.
- `compactContinuationPrompt(goal)` — a short variant used on `session_compact`.
- `budgetLimitPrompt(goal)` — wrap-up guidance.

The current version's continuation/init prompts are notably **more detailed and prescriptive** than fitch's continuation prompt (e.g. "Treat alignment as movement toward the requested end state", "Match the verification scope to the requirement's scope").

**Fitch (`prompts.ts` + `prompts/create-goal.md`)** — three prompts + the slash-prompt template:
- `continuationPrompt(goal)` — shorter than current's; completion audit but more compact; includes `GOAL_TOOL_NAME_GUIDANCE` and `goalToolReference("update_goal")` namespacing.
- `compactContinuationPrompt(goal)` — used as a **user follow-up** (`deliverAs: "followUp"`) after `/goal resume` or `/goal <obj>` start, telling the agent to call `get_goal` if needed.
- `budgetLimitPrompt(goal)` — similar wrap-up, no "do not redefine success" line.
- `supersededContinuationMessage(goalId)` — used by queued-work rewriting to neutralize stale queued continuations.
- `prompts/create-goal.md` — a full pi prompt template that turns a free-form task into a 6-part completion contract (Outcome, Verification evidence, Constraints, Iteration policy, Completion audit, Blocked stop condition) and calls the goal tool with `replace_existing: true`. This is unique to fitch and effectively a second, structured onboarding path for goals.

Prompt philosophy: **current is richer in behavioral/fidelity prose; fitch is richer in tooling-awareness (namespacing, prompt template, superseded-message handling).**

---

## 5. Tools (`get_goal`, `create_goal`, `update_goal`)

Both expose the same three tools with the same semantics (get / create-with-optional-budget / mark-complete-only), but:

- **Schema**: current uses hand-written JSON Schema objects; fitch uses `typebox` `Type.Object` + `StringEnum` from `@earendil-works/pi-ai`.
- **`create_goal` params**: current = `{objective, token_budget}`; fitch adds `replace_existing: boolean`. Current returns a soft `error: "duplicate_goal"` text result; fitch throws via `throwToolError` when `createGoal`/`replaceGoal` returns `ok:false`.
- **`update_goal`**: current's `completeGoal` host method calls `completeGoalIdempotently` and returns the goal; fitch's `completeGoal` first runs `goalAccounting.accountProgress(ctx, false, 0, true)` then `stateController.completeGoal` and returns a `GoalResult` (`{ok, message, goal}`), surfacing messages like "Goal already complete."
- **`promptGuidelines`**: current has short per-tool snippets; fitch attaches a shared `TOOL_PROMPT_GUIDELINES` array including the namespasing rule and the "keep working through low-risk next steps instead of stopping at a plan" directive.
- **Tool `details`**: fitch returns `GoalToolResponse` (via `goalToolResponse(goal, includeCompletionBudgetReport)`) plus an `error: string | null` field; current returns a plainer `{goal}` / `{goal, error}`.

---

## 6. `/goal` command

| Behavior | Current | Fitch |
|---|---|---|
| `/goal` (bare) | shows status summary | shows `formatGoalSummary` |
| `/goal status` | explicit status subcommand | (no `status` keyword — bare `/goal` is status) |
| `/goal <objective>` | creates, with `--budget=`/`--tokens` flag parsing, confirms replace via UI | creates via `replaceGoal`, then **queues a turn** (`command_start` or user-follow-up depending on `GoalStartTurnStrategy`) |
| `/goal pause` / `resume` | `canPauseGoal`/`canResumeGoal` checks, transitions, notifies; resume triggers `scheduleContinuation` | `updateGoalStatus`; resume queues a user-follow-up continuation; special case: if already active with `userFollowUp` strategy, just re-queues a continuation |
| `/goal clear` | both | both |
| `/goal copy` | — | copies objective to clipboard |
| `/goal statusbar [on\|off\|toggle]` | yes | — |
| Tab completions | `status, pause, resume, clear, statusbar, statusbar on/off` | `pause, resume, clear, copy` |

A subtle but important difference: in the current version, **new goal / resume** triggers continuation scheduling inside the command host callback (in `index.ts`'s `setGoal`); in fitch the command **sends a queued message** (`queueGoalTurn`/`queueGoalUserTurn`) and the continuation scheduling is decoupled in `continuation-scheduler.ts`. Fitch also distinguishes `deliverAs: "followUp"` (user-message channel) vs the hidden `customType: CONTINUATION_MESSAGE_TYPE` turn.

---

## 7. Continuation & stale-queued-work

**Current**: `stale-queued-work-guard.ts` is ~50 lines, exposes `planTurnStart({queuedGoalId, currentGoalId, currentStatus})` and `planAgentEnd({queuedGoalId})` returning `{stale, effects[]}` where effects are `clearAccounting | refreshUi | abort`. `index.ts` applies effects and tracks `currentTurnQueuedGoalId` / `currentTurnIsStaleQueuedWork`. `queued-goal-work.ts` does provider-context rewrites on the `context` event. Continuation is a generation-counter guarded `scheduler(() => …)` with `pendingContinuation*` state.

**Fitch**: the stale-queued-work subsystem is split into 7 files: `stale-queued-work-types.ts`, `reducer.ts` (~13KB), `reducer-defaults.ts`, `obligations.ts` (~8KB), `terminal-cleanup.ts`, `guard.ts`, plus `continuation-scheduler.ts` (~6KB) and `queued-goal-work.ts` (~9KB, larger rewrite logic incl. `supersededContinuationMessage`). The reducer handles delayed terminal events, context aborts, provider errors, compaction, and shutdown explicitly (per the audit, "tested heavily against delayed terminal events, context aborts, provider errors, compaction, and shutdown"). Continuation scheduling lives in `createContinuationScheduler({pi, getGoal, getRecoveryState, staleQueuedWorkGuard, getCurrentTurnIndex})` and is coordinated with recovery phase.

Net: same *concept* of stale-queued-work, but fitch's implementation is far more exhaustive and is the result of many edge-case bug fixes (visible in the CHANGELOG: host-overflow fallback, duplicate-continuation avoidance, etc.).

---

## 8. Recovery (fitch only)

No equivalent in the current version. Fitch's `recovery-machine.ts` models:
- `ErrorRecoveryCounters` keyed by `failureSignature`/`CONTEXT_OVERFLOW_SIGNATURE` with `transientAttempts` and `compactionAttempts`.
- `planRecoveryForAssistantError(message)` → `{noop | pending | pause}`.
- `planRecoveryForSilentContextOverflow`, `isRepeatOverflowCompactionDue`.
- `RecoveryPhase` (`recovery-phase.ts`) with host-overflow user-start-turn gating, persisted via `host_overflow_cap_reset` entries and replayed by `reconstructHostOverflowCapNeedsUserReset`.
- `onRecoverySuccessfulTurn` resets counters; `onRecoveryUserInput` resets the machine; `onRecoverySessionCompact` clears pending host-overflow attention.

This is the single biggest functional gap: **the current version silently does nothing on provider/context-overflow errors**, while fitch pauses the goal with an attention reason and survives host auto-compaction.

---

## 9. Verification / maturity signals

- Fitch ships a `CHANGELOG.md` (0.1.0 → 0.1.27), `README.md`, `AGENTS.md`, `docs/CODEBASE_AUDIT.md`, `docs/platform-smoke.md`, a `verify` gate, and `scripts/`. Current has only `AGENTS.md` + `docs/agent-instructions/*`.
- Fitch `package.json` description/keywords/files are coherent and accurate. Current `package.json` still describes a "hashline editor" and lists `diff`/`file-type`/`xxhash-wasm` deps that the goal `src/` doesn't use — clear sign the current workspace is a **fresh, in-progress reimplementation** built on top of a copied scaffold.
- Fitch peer baseline is pi `0.79.x` and uses newer SDK helpers (`StringEnum`, typebox, `deliverAs: "followUp"`). Current targets `>=0.74.0` and uses older patterns (`setTimeout` scheduler, plain JSON schema).

---

## Summary

- **Current `pi-goal`** is a compact, readable, single-file-runtime take: rich behavioral prompts, a `statusbar` toggle, explicit `cleared` status, CLI budget flags, and a visible `pi-goal-event` renderer — but no error recovery, no host-overflow handling, no `replace_existing`, no prompt template, narrower stale-queued-work handling, and a stale `package.json`.
- **`fitchmultz-pi-codex-goal`** is the mature, productionized fork: heavily decomposed (~37 modules), a validated transition-planner with invariant guards, monotonic runtime-usage persistence, a full provider-error / context-overflow recovery state machine, host-overflow user-reset gating, `replace_existing` + `/goal copy` + `/goal:create` prompt template, MCP-aware tool-name guidance, and a platform-smoke release gate — at the cost of much higher structural complexity.

If you want, I can next (a) produce a feature-by-feature migration table showing what current would need to adopt from fitch, or (b) diff a specific subsystem (e.g. continuation scheduling or stale-queued-work) line-by-line.