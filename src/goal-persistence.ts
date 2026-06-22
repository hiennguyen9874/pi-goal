import {
  ENTRY_TYPE,
  clearGoalEntry,
  cloneGoal,
  goalEntry,
  goalsEquivalent,
  runtimeUsageEntry,
  type GoalState,
} from "./state.ts";

export interface GoalPersistenceDeps {
  appendEntry(customType: string, data: unknown): void;
  clock(): number;
  statusBarEnabled(): boolean;
}

export type GoalPersistenceSource = "set" | "runtime" | "clear";

function hasRuntimeUsageStatus(goal: GoalState): boolean {
  return goal.status === "active" || goal.status === "budget_limited";
}

function staticGoalFieldsMatch(a: GoalState, b: GoalState): boolean {
  return a.goalId === b.goalId
    && a.objective === b.objective
    && a.tokenBudget === b.tokenBudget
    && a.createdAt === b.createdAt;
}

export function createGoalPersistence(deps: GoalPersistenceDeps) {
  let currentGoal: GoalState | null = null;
  let lastPersistedGoal: GoalState | null = null;
  let lastRuntimePersistAt: number | null = null;

  function appendSet(goal: GoalState): void {
    const at = deps.clock();
    deps.appendEntry(ENTRY_TYPE, goalEntry(goal, at, deps.statusBarEnabled()));
    lastPersistedGoal = cloneGoal(goal);
    lastRuntimePersistAt = at;
  }

  function appendUsage(goal: GoalState): void {
    const at = deps.clock();
    deps.appendEntry(ENTRY_TYPE, runtimeUsageEntry({
      goalId: goal.goalId,
      status: goal.status as "active" | "budget_limited",
      tokensUsed: goal.tokensUsed,
      timeUsedSeconds: goal.timeUsedSeconds,
      turnCount: goal.turnCount,
      continuationCount: goal.continuationCount,
      updatedAt: goal.updatedAt,
    }, at, deps.statusBarEnabled()));
    lastPersistedGoal = cloneGoal(goal);
    lastRuntimePersistAt = at;
  }

  function canPersistUsage(goal: GoalState): boolean {
    return lastPersistedGoal !== null
      && staticGoalFieldsMatch(goal, lastPersistedGoal)
      && hasRuntimeUsageStatus(goal)
      && hasRuntimeUsageStatus(lastPersistedGoal);
  }

  return {
    getCurrentGoal(): GoalState | null {
      return currentGoal;
    },

    setCurrentGoal(goal: GoalState | null): void {
      currentGoal = goal;
    },

    syncPersistedSnapshot(goal: GoalState | null): void {
      lastPersistedGoal = goal ? cloneGoal(goal) : null;
      lastRuntimePersistAt = null;
    },

    persistCurrent(source: "set" | "runtime", options?: { force?: boolean }): boolean {
      if (!currentGoal) return false;
      if (!options?.force && goalsEquivalent(currentGoal, lastPersistedGoal)) return false;
      if (source === "runtime" && canPersistUsage(currentGoal)) {
        appendUsage(currentGoal);
      } else {
        appendSet(currentGoal);
      }
      return true;
    },

    appendClearEntry(clearedGoalId: string | null): void {
      const at = deps.clock();
      deps.appendEntry(ENTRY_TYPE, clearGoalEntry(clearedGoalId, at, deps.statusBarEnabled()));
      currentGoal = null;
      lastPersistedGoal = null;
      lastRuntimePersistAt = null;
    },

    getLastRuntimePersistAt(): number | null {
      return lastRuntimePersistAt;
    },
  };
}
