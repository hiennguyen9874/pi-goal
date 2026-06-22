import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { registerGoalCommand } from "./commands.ts";
import { formatDuration, formatFooterStatus, formatTokenValue } from "./format.ts";
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
import { applyGoalTransitionEffects } from "./goal-transition-effects.ts";
import { applyQueuedGoalProviderContextRewrites } from "./queued-goal-work.ts";
import { createStaleQueuedWorkGuard, type StaleQueuedWorkEffect } from "./stale-queued-work-guard.ts";
import { isErrorAssistantMessage } from "./recovery.ts";
import {
  createGoalRecoveryMachine,
  onRecoverySuccessfulTurn,
  onRecoveryUserInput,
  planRecoveryForAssistantError,
  recoveryBlocksContinuation,
  resetRecoveryMachine,
} from "./recovery-machine.ts";

export interface GoalExtensionOptions {
  clock?: () => number;
  scheduler?: (fn: () => void) => unknown;
}

type GoalEventKind = "created" | "paused" | "resumed" | "cleared" | "completed";
const GOAL_EVENT_MESSAGE_TYPE = "pi-goal-event";

interface UsageCarrier {
  usage?: Record<string, unknown>;
  metadata?: { usage?: Record<string, unknown> };
  tokens?: Record<string, unknown>;
}

function numberFrom(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
}

function textComponent(text: string) {
  return {
    render(width: number): string[] {
      const safeWidth = Math.max(1, Math.trunc(width));
      return [text.length > safeWidth ? text.slice(0, safeWidth) : text];
    },
    invalidate() {},
  };
}

export function extractTokenUsage(message: UsageCarrier | undefined): number {
  const usage = message?.usage ?? message?.metadata?.usage ?? message?.tokens;
  if (!usage) return 0;
  const explicitTotal = numberFrom(usage.totalTokens ?? usage.total);
  if (explicitTotal > 0) return explicitTotal;
  return numberFrom(usage.input ?? usage.inputTokens ?? usage.promptTokens)
    + numberFrom(usage.output ?? usage.outputTokens ?? usage.completionTokens)
    + numberFrom(usage.reasoning ?? usage.reasoningTokens)
    + numberFrom(usage.cacheRead ?? usage.cacheReadTokens)
    + numberFrom(usage.cacheWrite ?? usage.cacheWriteTokens);
}

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
  let awaitingContinuationGoalId: string | null = null;
  let continuationGeneration = 0;
  let pendingContinuationGoalId: string | null = null;
  let pendingContinuationMessage: string | null = null;
  let pendingContinuationGeneration = 0;
  let activeTurnStartedAt: number | null = null;
  let currentTurnHadToolCall = false;
  let currentTurnIsContinuation = false;
  let pendingCompletionGoalId: string | null = null;
  let toolsRestricted = false;
  const staleQueuedWorkGuard = createStaleQueuedWorkGuard();
  let currentTurnQueuedGoalId: string | null = null;
  let currentTurnIsStaleQueuedWork = false;
  const recoveryState = createGoalRecoveryMachine();

  function clearActiveTurnAccounting(): void {
    activeTurnStartedAt = null;
    currentTurnHadToolCall = false;
    currentTurnIsContinuation = false;
  }

  function applyStaleQueuedWorkEffects(effects: readonly StaleQueuedWorkEffect[], ctx: ExtensionContext): void {
    for (const effect of effects) {
      if (effect.type === "clearAccounting") clearActiveTurnAccounting();
      else if (effect.type === "refreshUi") refreshStatus(ctx);
      else if (effect.type === "abort") ctx.abort?.();
    }
  }

  function refreshStatus(ctx: Pick<ExtensionContext, "ui">): void {
    ctx.ui.setStatus("pi-goal", statusBarEnabled ? formatFooterStatus(currentGoal, recoveryState.attention) : undefined);
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
    pendingCompletionGoalId = null;
    staleQueuedWorkGuard.clear();
    currentTurnQueuedGoalId = null;
    currentTurnIsStaleQueuedWork = false;
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
    awaitingContinuationGoalId = null;
    pendingCompletionGoalId = null;
    if (currentGoal?.continuationScheduled) {
      currentGoal = { ...currentGoal, continuationScheduled: false };
    }
    continuationGeneration++;
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
    continuationGeneration++;
    pendingContinuationGeneration++;
    pendingContinuationGoalId = null;
    pendingContinuationMessage = null;
    staleQueuedWorkGuard.clear();
    currentTurnQueuedGoalId = null;
    currentTurnIsStaleQueuedWork = false;
    if (currentGoal?.continuationScheduled) {
      currentGoal = { ...currentGoal, continuationScheduled: false, updatedAt: clock() };
    }
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

    applyGoalTransitionEffects(phaseEffects, {
      clearContinuation: invalidateContinuation,
      clearActiveAccounting: clearActiveTurnAccounting,
      clearPendingCompletion: () => { pendingCompletionGoalId = null; },
      clearStaleQueuedWork: () => {
        staleQueuedWorkGuard.clear();
        currentTurnQueuedGoalId = null;
        currentTurnIsStaleQueuedWork = false;
      },
      resetRecovery: () => resetRecoveryMachine(recoveryState),
      clearBudgetWarning: () => {},
      markContinuationQueued: () => {},
      syncTools: () => syncGoalTools(pi),
      refreshUi: () => refreshStatus(ctx),
    });
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
    return pendingContinuationGoalId !== null && pendingContinuationMessage !== null;
  }

  function schedulePendingContinuation(
    pi: Pick<ExtensionAPI, "sendMessage" | "appendEntry">,
    ctx?: Pick<ExtensionContext, "isIdle" | "hasPendingMessages">,
  ): boolean {
    if (!hasPendingContinuation()) return false;
    const generation = ++pendingContinuationGeneration;

    scheduler(() => {
      if (generation !== pendingContinuationGeneration) return;
      if (!currentGoal || currentGoal.goalId !== pendingContinuationGoalId || currentGoal.status !== "active") return;
      if (recoveryBlocksContinuation(recoveryState)) return;
      if (toolsRestricted || currentGoal.continuationSuppressed) return;
      if (!currentGoal.continuationScheduled) return;
      if (ctx && (!ctx.isIdle() || ctx.hasPendingMessages())) return;

      const goalId = currentGoal.goalId;
      const message = pendingContinuationMessage;
      pendingContinuationGoalId = null;
      pendingContinuationMessage = null;

      currentGoal = {
        ...currentGoal,
        continuationScheduled: false,
        continuationCount: currentGoal.continuationCount + 1,
        updatedAt: clock(),
      };
      persist(pi, currentGoal, { force: true });
      awaitingContinuationGoalId = goalId;

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
    if (!shouldScheduleContinuation(currentGoal, { toolsRestricted, recoveryBlocked: recoveryBlocksContinuation(recoveryState) })) return false;

    currentGoal = { ...currentGoal!, continuationScheduled: true, updatedAt: clock() };
    persist(pi, currentGoal!, { force: true });

    pendingContinuationGoalId = currentGoal!.goalId;
    pendingContinuationMessage = continuationPrompt(currentGoal!);
    continuationGeneration++;

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
        if (result.changed) pendingCompletionGoalId = currentGoal.goalId;
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
      if (!recoveryBlocksContinuation(recoveryState)) ensurePendingContinuation(pi, ctx);
    });
    pi.on("before_agent_start", (event) => {
      const activeTools = new Set(pi.getActiveTools());
      const hasMutatingTool = activeTools.has("edit") || activeTools.has("write") || activeTools.has("bash");
      toolsRestricted = !hasMutatingTool;
    });
    pi.on("input", (event) => {
      if (event.source === "extension" || !currentGoal) return { action: "continue" };
      onRecoveryUserInput(recoveryState);
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
      activeTurnStartedAt = event.timestamp ?? clock();
      currentTurnHadToolCall = false;
      
      const eventAny = event as unknown as { details?: { goalId?: unknown }; message?: string };
      const queuedGoalId = typeof eventAny.details?.goalId === "string"
        ? eventAny.details.goalId
        : typeof eventAny.message === "string"
          ? continuationGoalIdFromMessage(eventAny.message)
          : null;
      currentTurnQueuedGoalId = queuedGoalId;

      const plan = staleQueuedWorkGuard.planTurnStart({
        queuedGoalId,
        currentGoalId: currentGoal?.goalId ?? null,
        currentStatus: currentGoal?.status ?? null,
      });
      currentTurnIsStaleQueuedWork = plan.stale;

      if (plan.stale) {
        applyStaleQueuedWorkEffects(plan.effects, ctx);
        currentTurnIsContinuation = false;
        return;
      }
      
      // Normal case: not stale
      currentTurnIsContinuation = currentGoal?.goalId === awaitingContinuationGoalId;
      if (currentGoal?.goalId === awaitingContinuationGoalId) awaitingContinuationGoalId = null;
    });
    pi.on("turn_end", (event, ctx) => {
      if (currentTurnIsStaleQueuedWork) {
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

      const elapsedSeconds = activeTurnStartedAt === null ? 0 : Math.max(0, Math.floor((clock() - activeTurnStartedAt) / 1000));
      const tokensDelta = extractTokenUsage(event.message as UsageCarrier | undefined);
      const accountingNow = Math.max(clock(), currentGoal.updatedAt);
      const result = applyGoalUsage(currentGoal, {
        tokensDelta,
        secondsDelta: elapsedSeconds,
        hadToolCall: currentTurnHadToolCall,
        wasContinuation: currentTurnIsContinuation,
        now: accountingNow,
      });
      const isCompleting = pendingCompletionGoalId === result.goal.goalId;
      const transitionPlan = isCompleting
        ? planGoalTransition(result.goal, { kind: "complete", now: Math.max(clock(), result.goal.updatedAt) })
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
      const agentEndPlan = staleQueuedWorkGuard.planAgentEnd({ queuedGoalId: currentTurnQueuedGoalId });
      if (agentEndPlan.skipContinuation) {
        applyStaleQueuedWorkEffects(agentEndPlan.effects, ctx);
        currentTurnQueuedGoalId = null;
        currentTurnIsStaleQueuedWork = false;
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
        const action = planRecoveryForAssistantError(recoveryState, lastError);
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
      if (lastAssistant) onRecoverySuccessfulTurn(recoveryState, lastAssistant);

      ensurePendingContinuation(pi, ctx);
      syncGoalTools(pi);
      refreshStatus(ctx);
    });
    pi.on("tool_execution_end", () => {
      currentTurnHadToolCall = true;
    });
    pi.on("session_shutdown", () => {
      flushRuntimePersistence(pi);
      invalidateContinuation();
      awaitingContinuationGoalId = null;
      activeTurnStartedAt = null;
      currentTurnHadToolCall = false;
      currentTurnIsContinuation = false;
      pendingCompletionGoalId = null;
      pendingContinuationGoalId = null;
      pendingContinuationMessage = null;
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
