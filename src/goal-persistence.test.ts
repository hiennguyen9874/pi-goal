import { test } from "vitest";
import assert from "node:assert/strict";

import { createGoalPersistence } from "./goal-persistence.ts";
import { ENTRY_TYPE, createGoal, type GoalEntry } from "./state.ts";

test("runtime persistence writes usage entry when static goal fields match", () => {
  const entries: Array<{ customType: string; data: GoalEntry }> = [];
  const persistence = createGoalPersistence({
    appendEntry(customType, data) { entries.push({ customType, data: data as GoalEntry }); },
    clock: () => 1000,
    statusBarEnabled: () => true,
  });

  const goal = createGoal("Ship", 100, { goalId: "g", now: 1 });
  persistence.setCurrentGoal(goal);
  persistence.persistCurrent("set", { force: true });

  persistence.setCurrentGoal({ ...goal, tokensUsed: 10, timeUsedSeconds: 2, turnCount: 1, updatedAt: 2000 });
  persistence.persistCurrent("runtime", { force: true });

  assert.equal(entries[0]?.customType, ENTRY_TYPE);
  assert.equal(entries[0]?.data.action, "set");
  assert.equal(entries[1]?.data.action, "usage");
  assert.equal(entries[1]?.data.goalId, "g");
});

test("runtime persistence falls back to set when static fields changed", () => {
  const entries: Array<{ customType: string; data: GoalEntry }> = [];
  const persistence = createGoalPersistence({
    appendEntry(customType, data) { entries.push({ customType, data: data as GoalEntry }); },
    clock: () => 1000,
    statusBarEnabled: () => true,
  });

  const goal = createGoal("Ship", 100, { goalId: "g", now: 1 });
  persistence.setCurrentGoal(goal);
  persistence.persistCurrent("set", { force: true });

  persistence.setCurrentGoal({ ...goal, objective: "Changed", tokensUsed: 10, updatedAt: 2000 });
  persistence.persistCurrent("runtime", { force: true });

  assert.equal(entries[1]?.data.action, "set");
});
