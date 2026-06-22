import { test } from "vitest";
import assert from "node:assert/strict";

import { buildGoalUsageDelta, extractTokenUsage } from "./goal-accounting.ts";

test("extractTokenUsage handles total token fields first", () => {
  assert.equal(extractTokenUsage({ usage: { totalTokens: 42, input: 10, output: 10 } }), 42);
  assert.equal(extractTokenUsage({ metadata: { usage: { total: 7 } } }), 7);
});

test("extractTokenUsage sums known token fields", () => {
  assert.equal(extractTokenUsage({ usage: { input: 10, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5 } }), 24);
  assert.equal(extractTokenUsage({ tokens: { promptTokens: 6, completionTokens: 7, reasoningTokens: 8 } }), 21);
});

test("buildGoalUsageDelta computes non-negative elapsed seconds", () => {
  assert.deepEqual(buildGoalUsageDelta({
    message: { usage: { totalTokens: 10 } },
    turnStartedAt: 1000,
    now: 4500,
    hadToolCall: true,
    wasContinuation: false,
  }), {
    tokensDelta: 10,
    secondsDelta: 3,
    hadToolCall: true,
    wasContinuation: false,
    now: 4500,
  });

  assert.equal(buildGoalUsageDelta({
    message: undefined,
    turnStartedAt: null,
    now: 4500,
    hadToolCall: false,
    wasContinuation: true,
  }).secondsDelta, 0);
});
