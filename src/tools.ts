import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { goalToolText } from "./format.ts";
import { createGoal, type GoalState } from "./state.ts";

export interface GoalToolHost {
  getGoal(): GoalState | null;
  setGoal(goal: GoalState, source: "tool", ctx: unknown): void;
  completeGoal(source: "tool", ctx: unknown): GoalState;
}

const EmptyParams = { type: "object", properties: {}, additionalProperties: false };
const CreateGoalParams = {
  type: "object",
  properties: {
    objective: { type: "string", description: "Concrete objective to pursue until completion. Write this as a completion contract, not a task summary." },
    token_budget: { type: "integer", minimum: 1, description: "Optional positive token budget." },
    replace_existing: {
      type: "boolean",
      description: "Replace an existing non-terminal goal only when the user explicitly asked to set a new goal over the current one.",
    },
  },
  required: ["objective"],
  additionalProperties: false,
};
const UpdateGoalParams = {
  type: "object",
  properties: {
    status: { type: "string", enum: ["complete"], description: "Only complete is accepted." },
  },
  required: ["status"],
  additionalProperties: false,
};

function textResult(text: string, details: unknown = undefined) {
  return { content: [{ type: "text" as const, text }], details };
}

export function registerGoalTools(pi: Pick<ExtensionAPI, "registerTool">, host: GoalToolHost): void {
  pi.registerTool({
    name: "get_goal",
    label: "Get Goal",
    description: "Return the current pi-goal state, if one exists.",
    promptSnippet: "Inspect the current pi-goal objective, status, elapsed time, and token budget.",
    promptGuidelines: ["Use get_goal only when the current pi-goal state is needed for goal-related work."],
    parameters: EmptyParams,
    async execute() {
      const goal = host.getGoal();
      return textResult(goalToolText(goal), { goal });
    },
  });

  pi.registerTool({
    name: "create_goal",
    label: "Create Goal",
    description: "Create one active pi-goal for a long-running objective. Use only when the user explicitly asks to start or replace a persistent goal.",
    promptSnippet: "Create one active pi-goal from an explicit user request.",
    promptGuidelines: [
      "Use create_goal only when the user explicitly asks to start or replace a persistent goal.",
      "Write the objective as a completion contract, not a task summary.",
      "Include outcome, Verification evidence, constraints, boundaries, iteration policy, and blocked stop condition when they are known.",
      "Do not set token_budget unless the user explicitly provided a budget or limit.",
      "Use replace_existing only when the user explicitly asked to set a new goal over the current one.",
    ],
    parameters: CreateGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = host.getGoal();
      const shouldReplace = (params as { replace_existing?: boolean }).replace_existing === true;
      if (current && current.status !== "complete" && current.status !== "cleared" && !shouldReplace) {
        return textResult("Error: cannot create a new goal because this session already has a non-terminal goal.", { goal: current, error: "duplicate_goal" });
      }
      const goal = createGoal((params as { objective: string }).objective, (params as { token_budget?: number }).token_budget ?? null);
      host.setGoal(goal, "tool", ctx);
      return textResult(goalToolText(goal), { goal });
    },
  });

  pi.registerTool({
    name: "update_goal",
    label: "Update Goal",
    description: "Mark the current pi-goal complete only after evidence proves the objective is fully achieved.",
    promptSnippet: "Mark the current pi-goal complete after a strict completion audit.",
    promptGuidelines: [
      "Use update_goal with status complete only when concrete evidence proves every goal requirement is complete.",
      "Do not use update_goal to pause, resume, clear, abandon, or budget-limit a goal.",
    ],
    parameters: UpdateGoalParams,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params?.status !== "complete") {
        throw new Error("update_goal only accepts status=complete.");
      }
      const goal = host.completeGoal("tool", ctx);
      return textResult(goalToolText(goal, true), { goal });
    },
  });
}
