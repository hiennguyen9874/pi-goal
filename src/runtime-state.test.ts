import { test } from "vitest";
import assert from "node:assert/strict";

import { createGoalRuntimeState } from "./runtime-state.ts";

test("runtime state initializes all mutable runtime slots", () => {
  const state = createGoalRuntimeState();

  assert.equal(state.awaitingContinuationGoalId, null);
  assert.equal(state.continuationGeneration, 0);
  assert.equal(state.pendingContinuationGoalId, null);
  assert.equal(state.pendingContinuationMessage, null);
  assert.equal(state.activeTurnGoalId, null);
  assert.equal(state.activeTurnStartedAt, null);
  assert.equal(state.currentTurnHadToolCall, false);
  assert.equal(state.currentTurnIsContinuation, false);
  assert.equal(state.pendingCompletionGoalId, null);
  assert.equal(state.toolsRestricted, false);
  assert.equal(state.currentTurnQueuedGoalId, null);
  assert.equal(state.currentTurnIsStaleQueuedWork, false);
  assert.equal(state.recovery.attention, null);
});

test("clearActiveTurnAccounting resets per-turn accounting fields", () => {
  const state = createGoalRuntimeState();
  state.activeTurnGoalId = "g";
  state.activeTurnStartedAt = 100;
  state.currentTurnHadToolCall = true;
  state.currentTurnIsContinuation = true;

  state.clearActiveTurnAccounting();

  assert.equal(state.activeTurnGoalId, null);
  assert.equal(state.activeTurnStartedAt, null);
  assert.equal(state.currentTurnHadToolCall, false);
  assert.equal(state.currentTurnIsContinuation, false);
});

test("clearQueuedTurnState resets stale queued work markers", () => {
  const state = createGoalRuntimeState();
  state.currentTurnQueuedGoalId = "g";
  state.currentTurnIsStaleQueuedWork = true;

  state.clearQueuedTurnState();

  assert.equal(state.currentTurnQueuedGoalId, null);
  assert.equal(state.currentTurnIsStaleQueuedWork, false);
});
