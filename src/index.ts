import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerGoalCommand } from "./commands.ts";
import { formatDuration, formatFooterStatus, formatTokenValue } from "./format.ts";
import { buildGoalUsageDelta, type UsageCarrier } from "./goal-accounting.ts";
import { budgetLimitPrompt, continuationGoalIdFromMessage, continuationPrompt, initPrompt } from "./prompts.ts";
import {
  CONTINUATION_MESSAGE_TYPE,
  ENTRY_TYPE,
  reconstructGoal,
  applyGoalUsage,
  completeGoalIdempotently,
  type GoalEntry,
  type GoalState,
} from "./state.ts";
import { createGoalPersistence } from "./goal-persistence.ts";
import { registerGoalTools } from "./tools.ts";
import { planGoalTransition, type GoalTransitionEffect, type GoalTransitionPlan } from "./goal-transition.ts";
import { applyGoalTransitionEffects, type GoalTransitionEffectHandlers } from "./goal-transition-effects.ts";
import { createGoalRuntimeState } from "./runtime-state.ts";
import { applyQueuedGoalProviderContextRewrites } from "./queued-goal-work.ts";
import { createStaleQueuedWorkGuard, type StaleQueuedWorkEffect } from "./stale-queued-work-guard.ts";
import { isErrorAssistantMessage } from "./recovery.ts";
import {
  onRecoverySuccessfulTurn,
  onRecoveryUserInput,
  planRecoveryForAssistantError,
  planRecoveryForSilentContextOverflow,
  recoveryBlocksContinuation,
  resetRecoveryMachine,
} from "./recovery-machine.ts";

export interface GoalExtensionOptions {
  clock?: () => number;
  scheduler?: (fn: () => void) => unknown;
}

type GoalEventKind = "created" | "paused" | "resumed" | "cleared" | "completed";
const GOAL_EVENT_MESSAGE_TYPE = "pi-goal-event";

function textComponent(text: string) {
  return {
    render(width: number): string[] {
      const safeWidth = Math.max(1, Math.trunc(width));
      return [text.length > safeWidth ? text.slice(0, safeWidth) : text];
    },
    invalidate() {},
  };
}

export { extractTokenUsage } from "./goal-accounting.ts";

export function shouldScheduleContinuation(
  goal: GoalState | null,
  options: { toolsRestricted?: boolean; recoveryBlocked?: boolean },
): boolean {
  if (!goal) return false;
  if (goal.status !== "active") return false;
  if (goal.continuationScheduled) return false;
  if (goal.continuationSuppressed) return false;
  if (options.toolsRestricted) return false;
  if (options.recoveryBlocked) return false;
  return true;
}

export function createGoalExtension(options: GoalExtensionOptions = {}) {
  const clock = options.clock ?? (() => Date.now());
  const scheduler = options.scheduler ?? ((fn: () => void) => setTimeout(fn, 0));
  let currentGoal: GoalState | null = null;
  const runtimePersistIntervalMs = 60_000;
  let statusBarEnabled = true;
  let appendEntryHost: Pick<ExtensionAPI, "appendEntry"> | null = null;
  const persistence = createGoalPersistence({
    appendEntry(customType, data) {
      if (!appendEntryHost) throw new Error("Goal persistence is not registered.");
      appendEntryHost.appendEntry(customType, data);
    },
    clock,
    statusBarEnabled: () => statusBarEnabled,
  });
  const runtimeState = createGoalRuntimeState();
  const staleQueuedWorkGuard = createStaleQueuedWorkGuard();

  function clearActiveTurnAccounting(): void {
    runtimeState.clearActiveTurnAccounting();
  }

  function applyStaleQueuedWorkEffects(effects: readonly StaleQueuedWorkEffect[], ctx: ExtensionContext): void {
    for (const effect of effects) {
      if (effect.type === "clearAccounting") clearActiveTurnAccounting();
      else if (effect.type === "refreshUi") refreshStatus(ctx);
      else if (effect.type === "abort") ctx.abort?.();
    }
  }

  function refreshStatus(ctx: Pick<ExtensionContext, "ui">): void {
    ctx.ui.setStatus("pi-goal", statusBarEnabled ? formatFooterStatus(currentGoal, runtimeState.recovery.attention) : undefined);
  }

  function syncGoalTools(pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">): void {
    const active = new Set(pi.getActiveTools());
    active.add("get_goal");
    active.add("create_goal");

    const showUpdateGoal = currentGoal?.status === "active";
    if (showUpdateGoal) active.add("update_goal");
    else active.delete("update_goal");

    pi.setActiveTools(Array.from(active));
  }

  function persist(
    _pi: Pick<ExtensionAPI, "appendEntry">,
    goal: GoalState,
    options?: { force?: boolean; source?: "set" | "runtime" },
  ): void {
    currentGoal = goal;
    persistence.setCurrentGoal(goal);
    persistence.persistCurrent(options?.source ?? "set", { force: options?.force });
  }

  function clear(_pi: Pick<ExtensionAPI, "appendEntry">): void {
    const clearedGoalId = currentGoal?.goalId ?? null;
    currentGoal = null;
    persistence.appendClearEntry(clearedGoalId);
    runtimeState.pendingCompletionGoalId = null;
    staleQueuedWorkGuard.clear();
    runtimeState.clearQueuedTurnState();
  }

  function restore(pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">, ctx: ExtensionContext): void {
    const branch = ctx.sessionManager.getBranch();
    currentGoal = reconstructGoal(branch);
    persistence.setCurrentGoal(currentGoal);
    persistence.syncPersistedSnapshot(currentGoal);
    for (const entry of branch) {
      if (entry?.type !== "custom" || entry.customType !== ENTRY_TYPE) continue;
      const data = entry.data as GoalEntry | undefined;
      if (typeof data?.statusBarEnabled === "boolean") statusBarEnabled = data.statusBarEnabled;
    }
    runtimeState.awaitingContinuationGoalId = null;
    runtimeState.pendingCompletionGoalId = null;
    if (currentGoal?.continuationScheduled) {
      currentGoal = { ...currentGoal, continuationScheduled: false };
    }
    runtimeState.continuationGeneration++;
    syncGoalTools(pi);
    refreshStatus(ctx);
  }

  function flushRuntimePersistence(pi: Pick<ExtensionAPI, "appendEntry">): void {
    if (!currentGoal) return;
    const lastRuntimePersistAt = persistence.getLastRuntimePersistAt();
    if (lastRuntimePersistAt !== null && clock() - lastRuntimePersistAt < runtimePersistIntervalMs) {
      return;
    }
    persist(pi, currentGoal, { source: "runtime" });
  }

  function invalidateContinuation(): void {
    runtimeState.continuationGeneration++;
    runtimeState.pendingContinuationGeneration++;
    runtimeState.pendingContinuationGoalId = null;
    runtimeState.pendingContinuationMessage = null;
    staleQueuedWorkGuard.clear();
    runtimeState.clearQueuedTurnState();
    if (currentGoal?.continuationScheduled) {
      currentGoal = { ...currentGoal, continuationScheduled: false, updatedAt: clock() };
    }
  }

  function transitionEffectHandlers(
    pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
    ctx: ExtensionContext,
  ): GoalTransitionEffectHandlers {
    return {
      clearContinuation: invalidateContinuation,
      clearActiveAccounting: clearActiveTurnAccounting,
      clearPendingCompletion: () => { runtimeState.pendingCompletionGoalId = null; },
      clearStaleQueuedWork: () => {
        staleQueuedWorkGuard.clear();
        runtimeState.clearQueuedTurnState();
      },
      resetRecovery: () => resetRecoveryMachine(runtimeState.recovery),
      clearBudgetWarning: () => { runtimeState.budgetWarningSentForGoalId = null; },
      // Continuation scheduling remains explicit at command/runtime call sites so the effect stays side-effect-safe.
      markContinuationQueued: () => {},
      syncTools: () => syncGoalTools(pi),
      refreshUi: () => refreshStatus(ctx),
    };
  }

  function applyTransitionEffects(
    pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
    effects: readonly GoalTransitionEffect[],
    ctx: ExtensionContext,
    phase: "beforePersist" | "afterPersist",
  ): void {
    const phaseEffects = effects.filter((effect) => {
      const isUiEffect = effect.type === "syncTools" || effect.type === "refreshUi" || effect.type === "markContinuationQueued";
      return phase === "afterPersist" ? isUiEffect : !isUiEffect;
    });

    applyGoalTransitionEffects(phaseEffects, transitionEffectHandlers(pi, ctx));
  }

  function applyTransitionPlan(
    pi: Pick<ExtensionAPI, "appendEntry" | "getActiveTools" | "setActiveTools">,
    plan: GoalTransitionPlan,
    ctx: ExtensionContext,
    options?: { force?: boolean },
  ): void {
    applyTransitionEffects(pi, plan.effects, ctx, "beforePersist");
    if (plan.persist === "set" || plan.persist === "usage") {
      if (!plan.nextGoal) throw new Error("Transition plan requires a goal to persist.");
      persist(pi, plan.nextGoal, {
        force: options?.force ?? plan.persist === "set",
        source: plan.persist === "usage" ? "runtime" : "set",
      });
    } else if (plan.persist === "clear") {
      clear(pi);
    } else if (plan.nextGoal) {
      currentGoal = plan.nextGoal;
    }
    applyTransitionEffects(pi, plan.effects, ctx, "afterPersist");
  }

  function hasPendingContinuation(): boolean {
    return runtimeState.pendingContinuationGoalId !== null && runtimeState.pendingContinuationMessage !== null;
  }

  function schedulePendingContinuation(
    pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">,
    ctx?: Pick<ExtensionContext, "isIdle" | "hasPendingMessages">,
  ): boolean {
    if (!hasPendingContinuation()) return false;
    const generation = ++runtimeState.pendingContinuationGeneration;

    scheduler(() => {
      if (generation !== runtimeState.pendingContinuationGeneration) return;
      if (!currentGoal || currentGoal.goalId !== runtimeState.pendingContinuationGoalId || currentGoal.status !== "active") return;
      if (recoveryBlocksContinuation(runtimeState.recovery)) return;
      if (runtimeState.toolsRestricted || currentGoal.continuationSuppressed) return;
      if (!currentGoal.continuationScheduled) return;
      if (ctx && (!ctx.isIdle() || ctx.hasPendingMessages())) return;

      const goalId = currentGoal.goalId;
      const message = runtimeState.pendingContinuationMessage;
      runtimeState.pendingContinuationGoalId = null;
      runtimeState.pendingContinuationMessage = null;

      currentGoal = {
        ...currentGoal,
        continuationScheduled: false,
        continuationCount: currentGoal.continuationCount + 1,
        updatedAt: clock(),
      };
      persist(pi, currentGoal, { force: true });
      runtimeState.awaitingContinuationGoalId = goalId;

      pi.sendMessage(
        {
          customType: CONTINUATION_MESSAGE_TYPE,
          content: message!,
          display: false,
          details: { goalId },
        },
        { triggerTurn: true },
      );
    });

    return true;
  }

  function scheduleContinuation(
    pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">,
    ctx?: Pick<ExtensionContext, "isIdle" | "hasPendingMessages">,
  ): boolean {
    if (!shouldScheduleContinuation(currentGoal, { toolsRestricted: runtimeState.toolsRestricted, recoveryBlocked: recoveryBlocksContinuation(runtimeState.recovery) })) return false;

    currentGoal = { ...currentGoal!, continuationScheduled: true, updatedAt: clock() };
    persist(pi, currentGoal!, { force: true });

    runtimeState.pendingContinuationGoalId = currentGoal!.goalId;
    runtimeState.pendingContinuationMessage = continuationPrompt(currentGoal!);
    runtimeState.continuationGeneration++;

    return schedulePendingContinuation(pi, ctx);
  }

  function ensurePendingContinuation(
    pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">,
    ctx?: Pick<ExtensionContext, "isIdle" | "hasPendingMessages">,
  ): boolean {
    if (hasPendingContinuation()) {
      return schedulePendingContinuation(pi, ctx);
    }
    return scheduleContinuation(pi, ctx);
  }

  function emitGoalEvent(pi: Pick<ExtensionAPI, "sendMessage">, kind: GoalEventKind, goal: GoalState | null): void {
    pi.sendMessage({
      customType: GOAL_EVENT_MESSAGE_TYPE,
      content: kind,
      display: true,
      details: {
        kind,
        objective: goal?.objective ?? null,
        status: goal?.status ?? null,
      },
    }, undefined);
  }

  function register(pi: ExtensionAPI): void {
    appendEntryHost = pi;
    (pi as unknown as { registerMessageRenderer?: Function }).registerMessageRenderer?.(
      GOAL_EVENT_MESSAGE_TYPE,
      (message: { details?: { kind?: string; objective?: string | null; status?: string | null } }) => textComponent(
        `Goal ${message.details?.kind ?? "updated"}${message.details?.objective ? `: ${message.details.objective}` : ""}`,
      ),
    );

    registerGoalTools(pi, {
      getGoal: () => currentGoal,
      setGoal(goal, _source, ctx) {
        const plan = planGoalTransition(currentGoal, { kind: "create_or_replace", nextGoal: goal, source: "tool" });
        applyTransitionPlan(pi, plan, ctx as ExtensionContext, { force: true });
      },
      completeGoal(_source, ctx) {
        if (!currentGoal) throw new Error("No goal is set.");
        const result = completeGoalIdempotently(currentGoal, clock());
        if (result.changed) runtimeState.pendingCompletionGoalId = currentGoal.goalId;
        refreshStatus(ctx as ExtensionContext);
        return result.goal;
      },
    });

    registerGoalCommand(pi, {
      getGoal: () => currentGoal,
      setGoal(goal, _source, ctx) {
        const previousGoal = currentGoal;
        const previousStatus = previousGoal?.status ?? null;
        const isNewGoal = previousGoal?.goalId !== goal.goalId;
        const plan = isNewGoal
          ? planGoalTransition(previousGoal, { kind: "create_or_replace", nextGoal: goal, source: "command" })
          : previousStatus === "active" && goal.status === "paused"
            ? planGoalTransition(previousGoal, { kind: "pause", now: goal.updatedAt })
            : previousStatus !== "active" && goal.status === "active"
              ? planGoalTransition(previousGoal, { kind: "resume", now: goal.updatedAt })
              : planGoalTransition(previousGoal, { kind: "create_or_replace", nextGoal: goal, source: "command" });
        applyTransitionPlan(pi, plan, ctx as ExtensionContext, { force: true });

        if (isNewGoal) emitGoalEvent(pi, "created", goal);
        if (!isNewGoal && previousStatus === "active" && goal.status === "paused") emitGoalEvent(pi, "paused", goal);
        if (!isNewGoal && previousStatus !== "active" && goal.status === "active") emitGoalEvent(pi, "resumed", goal);
        if (isNewGoal && goal.status === "active" && ctx.isIdle() && !ctx.hasPendingMessages()) {
          pi.sendUserMessage(initPrompt(goal));
        } else if (!isNewGoal && previousStatus !== "active" && goal.status === "active") {
          scheduleContinuation(pi, ctx);
        }
      },
      clearGoal(_source, ctx) {
        const clearedGoal = currentGoal;
        const plan = planGoalTransition(currentGoal, { kind: "clear" });
        applyTransitionPlan(pi, plan, ctx as ExtensionContext);
        emitGoalEvent(pi, "cleared", clearedGoal);
      },
      setStatusBar(value, _source, ctx) {
        statusBarEnabled = value === "on" ? true : value === "off" ? false : !statusBarEnabled;
        if (currentGoal) persist(pi, currentGoal);
        refreshStatus(ctx as ExtensionContext);
        return statusBarEnabled;
      },
    });

    pi.on("session_start", (event, ctx) => {
      restore(pi, ctx);
      if (event.reason === "reload" && currentGoal?.status === "active") {
        const plan = planGoalTransition(currentGoal, { kind: "pause", now: clock() });
        applyTransitionPlan(pi, plan, ctx, { force: true });
        ctx.ui.notify(`Goal paused after reload: ${currentGoal.objective}. Use /goal resume to continue.`);
      }
    });
    pi.on("session_tree", (_event, ctx) => restore(pi, ctx));
    pi.on("session_compact", (_event, ctx) => {
      restore(pi, ctx);
      flushRuntimePersistence(pi);
      if (currentGoal?.status === "active") {
        const action = planRecoveryForSilentContextOverflow(runtimeState.recovery);
        if (action.type === "pause") {
          const plan = planGoalTransition(currentGoal, {
            kind: "recovery_pause",
            reason: action.reason,
            now: clock(),
          });
          applyTransitionPlan(pi, plan, ctx, { force: true });
          ctx.ui.notify(`Goal paused for recovery: ${action.reason}`, "warning");
          return;
        }
      }
      if (!recoveryBlocksContinuation(runtimeState.recovery)) ensurePendingContinuation(pi, ctx);
    });
    pi.on("before_agent_start", (event) => {
      const activeTools = new Set(pi.getActiveTools());
      const hasMutatingTool = activeTools.has("edit") || activeTools.has("write") || activeTools.has("bash");
      runtimeState.toolsRestricted = !hasMutatingTool;
    });
    pi.on("input", (event) => {
      if (event.source === "extension" || !currentGoal) return { action: "continue" };
      onRecoveryUserInput(runtimeState.recovery);
      invalidateContinuation();
      if (currentGoal.status === "active") {
        currentGoal = {
          ...currentGoal,
          continuationSuppressed: false,
          lastContinuationHadToolCall: true,
          continuationScheduled: false,
          updatedAt: clock(),
        };
        persist(pi, currentGoal);
        syncGoalTools(pi);
      }
      return { action: "continue" };
    });
    pi.on("turn_start", (event, ctx) => {
      runtimeState.activeTurnStartedAt = event.timestamp ?? clock();
      runtimeState.currentTurnHadToolCall = false;
      
      const eventAny = event as unknown as { details?: { goalId?: unknown }; message?: string };
      const queuedGoalId = typeof eventAny.details?.goalId === "string"
        ? eventAny.details.goalId
        : typeof eventAny.message === "string"
          ? continuationGoalIdFromMessage(eventAny.message)
          : null;
      runtimeState.currentTurnQueuedGoalId = queuedGoalId;

      const plan = staleQueuedWorkGuard.planTurnStart({
        queuedGoalId,
        currentGoalId: currentGoal?.goalId ?? null,
        currentStatus: currentGoal?.status ?? null,
      });
      runtimeState.currentTurnIsStaleQueuedWork = plan.stale;

      if (plan.stale) {
        applyStaleQueuedWorkEffects(plan.effects, ctx);
        runtimeState.currentTurnIsContinuation = false;
        return;
      }
      
      // Normal case: not stale
      runtimeState.currentTurnIsContinuation = currentGoal?.goalId === runtimeState.awaitingContinuationGoalId;
      if (currentGoal?.goalId === runtimeState.awaitingContinuationGoalId) runtimeState.awaitingContinuationGoalId = null;
    });
    pi.on("turn_end", (event, ctx) => {
      if (runtimeState.currentTurnIsStaleQueuedWork) {
        clearActiveTurnAccounting();
        syncGoalTools(pi);
        refreshStatus(ctx);
        return;
      }

      if (currentGoal?.status !== "active") {
        syncGoalTools(pi);
        refreshStatus(ctx);
        return;
      }

      const now = clock();
      const accountingNow = Math.max(now, currentGoal.updatedAt);
      const usageDelta = buildGoalUsageDelta({
        message: event.message as UsageCarrier | undefined,
        turnStartedAt: runtimeState.activeTurnStartedAt,
        now,
        hadToolCall: runtimeState.currentTurnHadToolCall,
        wasContinuation: runtimeState.currentTurnIsContinuation,
      });
      const result = applyGoalUsage(currentGoal, { ...usageDelta, now: accountingNow });
      const isCompleting = runtimeState.pendingCompletionGoalId === result.goal.goalId;
      const transitionPlan = isCompleting
        ? planGoalTransition(result.goal, { kind: "complete", now: Math.max(now, result.goal.updatedAt) })
        : planGoalTransition(currentGoal, { kind: "runtime_accounting", nextGoal: result.goal });
      applyTransitionPlan(pi, transitionPlan, ctx, { force: isCompleting || result.crossedBudget });
      const nextGoal = transitionPlan.nextGoal!;
      if (isCompleting) {
        emitGoalEvent(pi, "completed", nextGoal);
        const parts: string[] = [`Goal achieved: ${nextGoal.objective}`];
        parts.push(`Time: ${formatDuration(nextGoal.timeUsedSeconds)}`);
        parts.push(`Tokens: ${formatTokenValue(nextGoal.tokensUsed)}${nextGoal.tokenBudget !== null ? ` / ${formatTokenValue(nextGoal.tokenBudget)}` : ""}`);
        parts.push(`Turns: ${nextGoal.turnCount} (${nextGoal.continuationCount} continuations)`);
        ctx.ui.notify(parts.join(" | "), "info");
      }
      if (result.crossedBudget && nextGoal.status !== "complete") {
        ctx.ui.notify(`Goal budget exhausted: ${formatTokenValue(result.goal.tokensUsed)} / ${formatTokenValue(result.goal.tokenBudget!)} tokens used. Wrapping up.`, "warning");
        pi.sendMessage(
          {
            customType: CONTINUATION_MESSAGE_TYPE,
            content: budgetLimitPrompt(result.goal),
            display: false,
            details: { goalId: result.goal.goalId, kind: "budget_limit" },
          },
          { triggerTurn: true, deliverAs: "steer" },
        );
      }
      if (result.goal.continuationSuppressed && !isCompleting && !result.crossedBudget) {
        ctx.ui.notify("Goal continuation paused: no progress detected. Send a message or /goal resume to continue.", "warning");
      }
    });
    pi.on("agent_end", (event, ctx) => {
      const agentEndPlan = staleQueuedWorkGuard.planAgentEnd({ queuedGoalId: runtimeState.currentTurnQueuedGoalId });
      if (agentEndPlan.skipContinuation) {
        applyStaleQueuedWorkEffects(agentEndPlan.effects, ctx);
        runtimeState.clearQueuedTurnState();
        syncGoalTools(pi);
        refreshStatus(ctx);
        return;
      }
      const messages = Array.isArray((event as { messages?: unknown[] }).messages)
        ? (event as { messages: unknown[] }).messages
        : [];
      const errorMessages = messages.filter(isErrorAssistantMessage);
      const lastError = errorMessages.at(-1);
      if (lastError) {
        const action = planRecoveryForAssistantError(runtimeState.recovery, lastError);
        if (action.type === "pending") {
          refreshStatus(ctx);
          syncGoalTools(pi);
          return;
        }
        if (action.type === "pause" && currentGoal?.status === "active") {
          const plan = planGoalTransition(currentGoal, {
            kind: "recovery_pause",
            reason: action.reason,
            now: clock(),
          });
          applyTransitionPlan(pi, plan, ctx, { force: true });
          ctx.ui.notify(`Goal paused for recovery: ${action.reason}`, "warning");
          return;
        }
      }

      const lastAssistant = [...messages].reverse().find((message) => {
        return Boolean(message && typeof message === "object" && (message as { role?: unknown }).role === "assistant");
      });
      if (lastAssistant) onRecoverySuccessfulTurn(runtimeState.recovery, lastAssistant);

      ensurePendingContinuation(pi, ctx);
      syncGoalTools(pi);
      refreshStatus(ctx);
    });
    pi.on("tool_execution_end", () => {
      runtimeState.currentTurnHadToolCall = true;
    });
    pi.on("session_shutdown", () => {
      flushRuntimePersistence(pi);
      invalidateContinuation();
      runtimeState.awaitingContinuationGoalId = null;
      runtimeState.clearActiveTurnAccounting();
      runtimeState.pendingCompletionGoalId = null;
      runtimeState.pendingContinuationGoalId = null;
      runtimeState.pendingContinuationMessage = null;
    });
    (pi.on as (event: string, handler: (event: { messages: unknown[] }) => unknown) => void)("context", (event) => {
      const result = applyQueuedGoalProviderContextRewrites(event.messages as Parameters<typeof applyQueuedGoalProviderContextRewrites>[0], currentGoal);
      return result.changed ? { messages: result.messages } : undefined;
    });
  }

  return { register, scheduleContinuation, get currentGoal() { return currentGoal; } };
}

export default function piGoalExtension(pi: ExtensionAPI): void {
  createGoalExtension().register(pi);
}
