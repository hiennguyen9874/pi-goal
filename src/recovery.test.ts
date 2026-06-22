import { test } from "vitest";
import assert from "node:assert/strict";

import {
  CONTEXT_OVERFLOW_SIGNATURE,
  failureSignature,
  formatRecoveryAttention,
  isContextOverflowError,
  isErrorAssistantMessage,
  isRetryableTransientError,
} from "./recovery.ts";
import {
  createGoalRecoveryMachine,
  onRecoverySuccessfulTurn,
  onRecoveryUserInput,
  planRecoveryForAssistantError,
  planRecoveryForSilentContextOverflow,
} from "./recovery-machine.ts";

test("detects context overflow and canonicalizes signature", () => {
  assert.equal(isContextOverflowError("context_length_exceeded: prompt too large"), true);
  assert.equal(isContextOverflowError("prompt is too long: 100000 tokens > 128000 maximum"), true);
  assert.equal(failureSignature("prompt is too long: 100000 tokens > 128000 maximum"), CONTEXT_OVERFLOW_SIGNATURE);
});

test("detects error assistant messages", () => {
  assert.equal(isErrorAssistantMessage({ role: "assistant", stopReason: "error" }), true);
  assert.equal(isErrorAssistantMessage({ role: "assistant", stopReason: "end_turn" }), false);
  assert.equal(isErrorAssistantMessage({ role: "user", stopReason: "error" }), false);
});

test("classifies retryable and non-retryable provider errors", () => {
  assert.equal(isRetryableTransientError("websocket closed before message_stop"), true);
  assert.equal(isRetryableTransientError("429 rate limit exceeded"), true);
  assert.equal(isRetryableTransientError("insufficient_quota 429"), false);
  assert.equal(isRetryableTransientError("Monthly usage limit reached"), false);
});

test("first context overflow is noop and repeated overflow pauses", () => {
  const state = createGoalRecoveryMachine();

  const first = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "context_length_exceeded",
  });
  assert.equal(first.type, "noop");
  assert.equal(state.counters.compactionAttempts, 1);

  const second = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "context_length_exceeded",
  });
  assert.equal(second.type, "pause");
  assert.match(second.reason, /context window recovery failed/i);
});

test("retryable transient error sets pending attention", () => {
  const state = createGoalRecoveryMachine();
  const action = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });

  assert.equal(action.type, "pending");
  assert.equal(state.attention?.kind, "pending");
  assert.match(formatRecoveryAttention(state.attention) ?? "", /Goal recovery pending/);
});

test("non-retryable provider error pauses immediately", () => {
  const state = createGoalRecoveryMachine();
  const action = planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "insufficient_quota 429",
  });

  assert.equal(action.type, "pause");
  assert.match(action.reason, /non-retryable provider error/i);
});

test("silent context overflow uses same compaction counter", () => {
  const state = createGoalRecoveryMachine();
  assert.equal(planRecoveryForSilentContextOverflow(state).type, "noop");
  assert.equal(planRecoveryForSilentContextOverflow(state).type, "pause");
});

test("successful assistant turn and user input reset recovery", () => {
  const state = createGoalRecoveryMachine();
  planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });
  assert.equal(state.attention?.kind, "pending");

  assert.equal(onRecoverySuccessfulTurn(state, { role: "assistant", stopReason: "end_turn" }), true);
  assert.equal(state.attention, null);

  planRecoveryForAssistantError(state, {
    role: "assistant",
    stopReason: "error",
    errorMessage: "websocket closed",
  });
  onRecoveryUserInput(state);
  assert.equal(state.attention, null);
  assert.equal(state.counters.signature, null);
});
