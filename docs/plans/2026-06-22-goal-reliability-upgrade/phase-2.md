# Phase 2: Onboarding Bundle and Tool/Command UX

**Goal:** Teach users and the model how to create strong auditable goals, add safe tool replacement semantics, and add `/goal copy` without weakening current continuation safety.

**Tasks:** 3 related tasks only.

## References

- Current tools: `src/tools.ts`
- Current commands/tests: `src/commands.ts`, `src/commands-tools.test.ts`
- Current package manifest test: `src/package-manifest.test.ts`
- Goal writer reference: `Michaelliv-pi-goal/skills/pi-goal-writer/SKILL.md`
- Prompt template reference: `fitchmultz-pi-codex-goal/prompts/create-goal.md`
- Tool replacement reference: `fitchmultz-pi-codex-goal/src/tools.ts`
- Clipboard command reference: `fitchmultz-pi-codex-goal/src/commands.ts`, `fitchmultz-pi-codex-goal/src/clipboard.ts`

### Task 1: Goal-Writing Skill and Prompt Template

**Files:**
- Create: `skills/pi-goal-writer/SKILL.md`
- Create: `prompts/create-goal.md`
- Modify: `package.json`
- Modify: `src/package-manifest.test.ts`

- [ ] **Step 1: Write failing packaging tests for skill and prompt**

Append these tests to `src/package-manifest.test.ts`:

```ts
test("package exposes goal-writing skill and create-goal prompt", () => {
  const pkg = readPackageJson();
  const skill = readFileSync("skills/pi-goal-writer/SKILL.md", "utf8");
  const prompt = readFileSync("prompts/create-goal.md", "utf8");

  assert.ok(pkg.files?.includes("skills"));
  assert.ok(pkg.files?.includes("prompts"));
  assert.ok(pkg.pi?.prompts?.includes("./prompts"));
  assert.match(skill, /completion contract/i);
  assert.match(skill, /Outcome/);
  assert.match(skill, /Verification surface/);
  assert.match(prompt, /replace_existing/);
  assert.match(prompt, /token budget/i);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/package-manifest.test.ts`

Expected: FAIL because `skills/`, `prompts/`, and `pi.prompts` are not present yet.

- [ ] **Step 3: Add package prompt/skill files**

Create `skills/pi-goal-writer/SKILL.md` by adapting `Michaelliv-pi-goal/skills/pi-goal-writer/SKILL.md` to current package names. Preserve these exact concepts:

- A goal is a completion contract.
- Strong goals include Outcome, Verification surface, Constraints, Boundaries, Iteration policy, and Blocked stop condition.
- The default output is a pasteable Pi `/goal` command.
- Do not invent commands or validation evidence.
- If blocked, stop with evidence, attempted paths, blocker, and next input needed.

Create `prompts/create-goal.md` by adapting `fitchmultz-pi-codex-goal/prompts/create-goal.md`. Required content:

```md
---
description: Convert a plain task into a strict evidence-based pi-goal and create it
argument-hint: "<task>"
---

User task:
$@

Turn the user task into exactly one durable pi-goal objective, then call the goal creation tool with that objective.

This prompt invocation is an explicit user request to set a new goal. When the goal creation tool exposes `replace_existing`, pass `replace_existing: true` so an existing active, paused, or budget-limited goal is replaced instead of requiring `/goal clear` first.

Do not set a token budget limit unless the user explicitly provides a budget or limit in the task. If no explicit budget is provided, omit the token budget field entirely.
```

After that opening, include the six required contract sections from the design: Outcome, Verification evidence, Constraints, Iteration policy, Completion audit, and Blocked stop condition. Use current status spelling `budget_limited` when naming statuses in explanatory text.

- [ ] **Step 4: Update package manifest**

Modify `package.json`:

```json
{
  "files": [
    "src",
    "docs",
    "skills",
    "prompts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "pi": {
    "extensions": ["./src/index.ts"],
    "prompts": ["./prompts"]
  }
}
```

Do not add a `pi.skills` field unless the Pi package format is confirmed to support it. The skill is shipped through `files` for now.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- src/package-manifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/package-manifest.test.ts skills/pi-goal-writer/SKILL.md prompts/create-goal.md
git commit -m "feat: add pi-goal writing guidance"
```

### Task 2: Richer Tool Guidance and `replace_existing`

**Files:**
- Modify: `src/tools.ts`
- Modify: `src/index.ts`
- Modify: `src/commands-tools.test.ts`
- Modify: `src/runtime.test.ts`

- [ ] **Step 1: Write failing tool tests**

Update `captureTools()` in `src/commands-tools.test.ts` so the fake host records set calls:

```ts
function captureTools(initial: GoalState | null = null) {
  const tools: Record<string, any> = {};
  let goal = initial;
  const setCalls: GoalState[] = [];
  const pi = { registerTool(tool: any) { tools[tool.name] = tool; } };
  registerGoalTools(pi as never, {
    getGoal: () => goal,
    setGoal(next) { goal = next; setCalls.push(next); },
    completeGoal() {
      if (!goal) throw new Error("No goal is set.");
      goal = { ...goal, status: "complete", updatedAt: 999 };
      return goal;
    },
  });
  return { tools, getGoal: () => goal, setCalls };
}
```

Add tests:

```ts
test("create_goal exposes completion-contract guidance and replace_existing schema", () => {
  const { tools } = captureTools();
  const create = tools.create_goal;

  assert.match(create.description, /long-running|goal/i);
  assert.ok(create.promptGuidelines.some((line: string) => /completion contract/i.test(line)));
  assert.ok(create.promptGuidelines.some((line: string) => /Verification evidence/i.test(line)));
  assert.equal(create.parameters.properties.replace_existing.type, "boolean");
});

test("create_goal replaces non-terminal goals only when replace_existing is true", async () => {
  const existing = createGoal("Existing", null, { goalId: "existing", now: 1 });
  const { tools, getGoal } = captureTools(existing);

  const duplicate = await tools.create_goal.execute("tool-1", { objective: "New" }, undefined, undefined, {});
  assert.match(duplicate.content[0].text, /cannot create/i);
  assert.equal(getGoal()?.goalId, "existing");

  const replaced = await tools.create_goal.execute(
    "tool-2",
    { objective: "New", token_budget: 50, replace_existing: true },
    undefined,
    undefined,
    {},
  );
  assert.equal(getGoal()?.objective, "New");
  assert.equal(getGoal()?.tokenBudget, 50);
  assert.notEqual(getGoal()?.goalId, "existing");
  assert.match(replaced.content[0].text, /"objective": "New"/);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/commands-tools.test.ts`

Expected: FAIL because schema/guidelines/replacement are not implemented.

- [ ] **Step 3: Update `src/tools.ts` schema and guidance**

Add `replace_existing` to `CreateGoalParams`:

```ts
replace_existing: {
  type: "boolean",
  description: "Replace an existing non-terminal goal only when the user explicitly asked to set a new goal over the current one.",
}
```

Update `create_goal` description and guidelines. Include these exact guideline ideas:

```ts
const GOAL_CONTRACT_GUIDELINES = [
  "Use create_goal only when the user explicitly asks to start or replace a persistent goal.",
  "Write the objective as a completion contract, not a task summary.",
  "Include outcome, Verification evidence, constraints, boundaries, iteration policy, and blocked stop condition when they are known.",
  "Do not set token_budget unless the user explicitly provided a budget or limit.",
  "Use replace_existing only when the user explicitly asked to set a new goal over the current one.",
];
```

Implementation behavior:

```ts
const shouldReplace = params.replace_existing === true;
if (current && current.status !== "complete" && current.status !== "cleared" && !shouldReplace) {
  return textResult("Error: cannot create a new goal because this session already has a non-terminal goal.", { goal: current, error: "duplicate_goal" });
}
const goal = createGoal(params.objective, params.token_budget ?? null);
host.setGoal(goal, "tool", ctx);
```

This phase allows tool replacement but still relies on `src/index.ts` to clear runtime state. Phase 3 will route both command and tool replacement through transition effects.

- [ ] **Step 4: Add runtime regression test for replacement invalidation**

Add this test to `src/runtime.test.ts` to catch the known current risk: tool-created replacement must invalidate queued continuation.

```ts
test("create_goal replace_existing invalidates pending continuation for old goal", async () => {
  const scheduled: Function[] = [];
  const pi = fakePi();
  createGoalExtension({ scheduler: (fn) => scheduled.push(fn), clock: () => 100 }).register(pi as never);
  const goal = activeGoal({ goalId: "old-goal" });
  const ctx = fakeCtx([{ type: "custom", customType: ENTRY_TYPE, data: { version: 1, action: "set", goal, at: 1 } }]);

  await pi.handlers.session_start[0]({}, ctx);
  await pi.handlers.agent_end[0]({ messages: [] }, ctx);
  assert.equal(scheduled.length, 1);

  await pi.tools.create_goal.execute(
    "tool-1",
    { objective: "Replacement", replace_existing: true },
    undefined,
    undefined,
    ctx,
  );

  scheduled[0]();

  assert.equal(pi.messages.some((entry) => entry.message.details?.goalId === "old-goal"), false);
  assert.equal(pi.messages.some((entry) => /old-goal/.test(String(entry.message.content))), false);
});
```

- [ ] **Step 5: Update tool `setGoal` path in `src/index.ts`**

In `registerGoalTools(pi, { setGoal(...) { ... } })`, call `invalidateContinuation()` before `persist()` so tool-created replacement has the same safety property as command replacement.

Required behavior:

```ts
setGoal(goal, _source, ctx) {
  invalidateContinuation();
  persist(pi, goal, { force: true });
  syncGoalTools(pi);
  refreshStatus(ctx as ExtensionContext);
}
```

Do not emit visible created/replaced events from the tool path in this task. Keep that behavior command-only unless a later phase intentionally changes event semantics.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- src/commands-tools.test.ts src/runtime.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/tools.ts src/index.ts src/commands-tools.test.ts src/runtime.test.ts
git commit -m "feat: allow explicit goal replacement tool"
```

### Task 3: `/goal copy` Command

**Files:**
- Create: `src/clipboard.ts`
- Modify: `src/commands.ts`
- Modify: `src/commands-tools.test.ts`
- Modify: `src/runtime.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write failing command parser and handler tests**

In `src/commands-tools.test.ts`, update the `GoalCommand` parser test:

```ts
assert.deepEqual(parseGoalCommand("copy"), { action: "copy" });
```

Extend `makeCtx()` so tests can provide clipboard behavior:

```ts
function makeCtx(hasUI = true, clipboard?: { writeText?: (text: string) => void | Promise<void> }) {
  const notifications: Array<{ message: string; level?: string }> = [];
  return {
    hasUI,
    notifications,
    clipboard,
    ui: {
      async confirm() { return true; },
      notify(message: string, level?: string) { notifications.push({ message, level }); },
      setStatus() {},
    },
    isIdle() { return true; },
    hasPendingMessages() { return false; },
  };
}
```

Add tests:

```ts
test("/goal copy copies current objective", async () => {
  let copied = "";
  const host = makeHost(createGoal("Build feature", null, { goalId: "g", now: 1 }));
  const ctx = makeCtx(true, { writeText(text) { copied = text; } });

  await handleGoalCommand(host, "copy", ctx as never);

  assert.equal(copied, "Build feature");
  assert.equal(host.getGoal()?.objective, "Build feature");
  assert.match(ctx.notifications.at(-1)?.message ?? "", /copied/i);
});

test("/goal copy warns when no goal exists", async () => {
  let copied = "";
  const host = makeHost(null);
  const ctx = makeCtx(true, { writeText(text) { copied = text; } });

  await handleGoalCommand(host, "copy", ctx as never);

  assert.equal(copied, "");
  assert.match(ctx.notifications.at(-1)?.message ?? "", /No goal/i);
});

test("/goal copy warns when clipboard is unavailable", async () => {
  const host = makeHost(createGoal("Build feature", null, { goalId: "g", now: 1 }));
  const ctx = makeCtx();

  await handleGoalCommand(host, "copy", ctx as never);

  assert.equal(host.getGoal()?.objective, "Build feature");
  assert.match(ctx.notifications.at(-1)?.message ?? "", /Clipboard.*unavailable/i);
});
```

- [ ] **Step 2: Run focused tests to verify they fail**

Run: `npm test -- src/commands-tools.test.ts`

Expected: FAIL because `copy` is not parsed or handled.

- [ ] **Step 3: Add clipboard adapter**

Create `src/clipboard.ts`:

```ts
export interface ClipboardHostLike {
  clipboard?: { writeText?: (text: string) => void | Promise<void> };
  ui?: { copyToClipboard?: (text: string) => void | Promise<void> };
}

export type ClipboardResult =
  | { ok: true }
  | { ok: false; message: string };

export async function copyTextToClipboard(text: string, host: ClipboardHostLike): Promise<ClipboardResult> {
  try {
    if (typeof host.clipboard?.writeText === "function") {
      await host.clipboard.writeText(text);
      return { ok: true };
    }
    if (typeof host.ui?.copyToClipboard === "function") {
      await host.ui.copyToClipboard(text);
      return { ok: true };
    }
    return { ok: false, message: "Clipboard unavailable in this Pi host." };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Clipboard write failed.";
    return { ok: false, message };
  }
}
```

This is intentionally smaller than Fitch's clipboard adapter and avoids shelling out to platform clipboard commands.

- [ ] **Step 4: Update command types and handler**

In `src/commands.ts`:

- Import `copyTextToClipboard`.
- Extend `GoalCommand` with `{ action: "copy" }`.
- Extend `GoalCommandContext` structurally to allow clipboard fields without depending on a specific Pi API:

```ts
export type GoalCommandContext = Pick<ExtensionCommandContext, "hasUI" | "ui" | "isIdle" | "hasPendingMessages"> & {
  clipboard?: { writeText?: (text: string) => void | Promise<void> };
};
```

- Parse `copy`:

```ts
if (trimmed === "pause" || trimmed === "resume" || trimmed === "clear" || trimmed === "copy") return { action: trimmed };
```

- Handle before pause/resume:

```ts
if (parsed.action === "copy") {
  if (!current) {
    ctx.ui.notify("No goal is set.", "info");
    return;
  }
  const result = await copyTextToClipboard(current.objective, ctx);
  if (result.ok) ctx.ui.notify("Goal objective copied.", "info");
  else ctx.ui.notify(`Clipboard unavailable: ${result.message}`, "warning");
  return;
}
```

- Add `copy` to completions.

- [ ] **Step 5: Update README command table**

Add:

```md
| `/goal copy` | Copy the current goal objective to the clipboard when supported by the host. |
```

- [ ] **Step 6: Run focused tests**

Run: `npm test -- src/commands-tools.test.ts`

Expected: PASS.

- [ ] **Step 7: Run full tests**

Run: `npm test`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/clipboard.ts src/commands.ts src/commands-tools.test.ts README.md
git commit -m "feat: add goal copy command"
```

## Phase Verification

- [ ] Package manifest tests pass: `npm test -- src/package-manifest.test.ts`
- [ ] Tool/command tests pass: `npm test -- src/commands-tools.test.ts`
- [ ] Runtime replacement regression passes: `npm test -- src/runtime.test.ts`
- [ ] Full test suite passes: `npm test`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Stop for human review if Pi package prompt support differs from `pi.prompts: ["./prompts"]`
