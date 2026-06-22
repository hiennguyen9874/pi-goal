# Phase 7: Smoke Gate and Final Regression Pass

**Goal:** Add a lightweight package smoke gate, update `verify` to run it, and perform final regression/documentation checks for the reliability upgrade.

**Tasks:** 3 related tasks only.

## References

- Current package scripts: `package.json`
- Current package manifest tests: `src/package-manifest.test.ts`
- Design smoke requirements: `docs/plans/2026-06-22-goal-reliability-upgrade/design.md`
- Fitch platform smoke reference: `fitchmultz-pi-codex-goal/package.json`, `fitchmultz-pi-codex-goal/scripts/platform-smoke.mjs`, `fitchmultz-pi-codex-goal/docs/platform-smoke.md`
- Keep this phase lightweight; do not copy Fitch's full multi-target smoke harness.

### Task 1: Lightweight Package Smoke Script

**Files:**
- Create: `scripts/package-smoke.mjs`
- Modify: `package.json`
- Modify: `src/package-manifest.test.ts`

- [ ] **Step 1: Write failing manifest test for smoke script**

Update `src/package-manifest.test.ts` script assertions:

```ts
assert.equal(pkg.scripts?.["smoke:package"], "node scripts/package-smoke.mjs");
assert.equal(pkg.scripts?.verify, "npm run typecheck && npm test && npm run smoke:package");
```

Also assert `files` includes scripts if the package should ship the smoke script:

```ts
assert.ok(pkg.files?.includes("scripts"));
```

- [ ] **Step 2: Run focused test to verify it fails**

Run: `npm test -- src/package-manifest.test.ts`

Expected: FAIL because `smoke:package` is not configured yet.

- [ ] **Step 3: Create `scripts/package-smoke.mjs`**

Create a Node-only smoke script. It must not require real provider credentials, network, or a live Pi host.

Required script behavior:

```js
#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function fail(message) {
  console.error(`package smoke failed: ${message}`);
  process.exitCode = 1;
}

const root = process.cwd();
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

if (pkg.name !== "pi-goal") fail("package name must be pi-goal");
if (!/goal/i.test(pkg.description ?? "")) fail("description must describe goals");
if (/hashline/i.test(pkg.description ?? "")) fail("description must not mention hashline");
if (!Array.isArray(pkg.pi?.extensions) || !pkg.pi.extensions.includes("./src/index.ts")) {
  fail("pi.extensions must include ./src/index.ts");
}
if (!existsSync(resolve(root, "src/index.ts"))) fail("src/index.ts must exist");
if (!existsSync(resolve(root, "README.md"))) fail("README.md must exist");
if (!existsSync(resolve(root, "CHANGELOG.md"))) fail("CHANGELOG.md must exist");

if (Array.isArray(pkg.pi?.prompts)) {
  for (const promptDir of pkg.pi.prompts) {
    if (!existsSync(resolve(root, promptDir))) fail(`prompt directory missing: ${promptDir}`);
  }
}

for (const shippedPath of ["skills", "prompts"]) {
  if (pkg.files?.includes(shippedPath) && !existsSync(resolve(root, shippedPath))) {
    fail(`files includes missing path: ${shippedPath}`);
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log("package smoke passed");
```

This is intentionally much smaller than `fitchmultz-pi-codex-goal/scripts/platform-smoke.mjs`; it checks local package integrity only.

- [ ] **Step 4: Update scripts and files**

Modify `package.json`:

```json
{
  "files": [
    "src",
    "docs",
    "skills",
    "prompts",
    "scripts",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "smoke:package": "node scripts/package-smoke.mjs",
    "verify": "npm run typecheck && npm test && npm run smoke:package"
  }
}
```

- [ ] **Step 5: Run focused smoke and manifest tests**

Run:

```bash
node scripts/package-smoke.mjs
npm test -- src/package-manifest.test.ts
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/package-smoke.mjs package.json package-lock.json src/package-manifest.test.ts
git commit -m "chore: add package smoke gate"
```

### Task 2: Documentation and Cross-Version Reference Audit

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/agent-instructions/architecture.md`
- Modify: `docs/agent-instructions/overview.md`

- [ ] **Step 1: Write docs audit checklist locally**

Before editing docs, inspect final implemented behavior:

```bash
grep -n "replace_existing\|copy\|recovery\|usage\|runtimeUsageEntry\|createGoalRecoveryMachine" -R src README.md docs/agent-instructions package.json
```

Expected: output identifies the implementation and docs locations. Use it to update docs accurately.

- [ ] **Step 2: Update README**

Ensure `README.md` documents:

- `/goal copy`
- `/goal:create` prompt template if packaged
- `create_goal.replace_existing`
- runtime recovery behavior and user actions
- compact runtime usage persistence at a user-appropriate level
- validation commands:

```md
## Development

Run tests:

```bash
npm test
```

Run typecheck:

```bash
npm run typecheck
```

Run package verification:

```bash
npm run verify
```
```

- [ ] **Step 3: Update `CHANGELOG.md`**

Add entries under `Unreleased > Goal Reliability Upgrade`:

```md
- Added goal-writing skill and `/goal:create` prompt template.
- Added explicit `create_goal.replace_existing` support.
- Added `/goal copy`.
- Added transition-planned lifecycle changes.
- Added replay-safe runtime usage entries.
- Added provider/context-overflow recovery attention.
- Added package smoke validation.
```

- [ ] **Step 4: Update agent instruction docs**

In `docs/agent-instructions/overview.md`:

- Add `/goal copy` to command table.
- Add `replace_existing` to model tool description.
- Add recovery attention to domain concepts.
- Mention runtime usage entries only if useful for future agents.

In `docs/agent-instructions/architecture.md`:

- Update component map with new modules:
  - `src/goal-transition.ts`
  - `src/goal-transition-effects.ts`
  - `src/goal-persistence.ts`
  - `src/goal-accounting.ts`
  - `src/runtime-state.ts`
  - `src/recovery.ts`
  - `src/recovery-machine.ts`
- Update data flow sections for transition planning, runtime usage replay, and recovery.
- Preserve existing notes about stale queued work and continuation suppression.

- [ ] **Step 5: Run docs-related checks**

Run:

```bash
npm run smoke:package
npm test -- src/package-manifest.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md docs/agent-instructions/overview.md docs/agent-instructions/architecture.md
git commit -m "docs: update goal reliability architecture notes"
```

### Task 3: Final Regression and Acceptance Audit

**Files:**
- Modify only if regressions are found: relevant `src/*.ts` or docs files

- [ ] **Step 1: Run narrow high-risk tests first**

Run:

```bash
npm test -- src/runtime.test.ts src/stale-queued-work-guard.test.ts src/queued-goal-work.test.ts src/recovery.test.ts src/goal-transition.test.ts src/goal-persistence.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm run verify
```

Expected: PASS. This runs typecheck, all tests, and package smoke.

- [ ] **Step 3: Perform acceptance audit against design**

Open `docs/plans/2026-06-22-goal-reliability-upgrade/design.md` and verify each acceptance criterion with concrete evidence:

- Package metadata and README describe `pi-goal`.
- Goal-writing guidance exists in `skills/pi-goal-writer/SKILL.md` and `prompts/create-goal.md`.
- `create_goal` supports `replace_existing` and tests cover duplicate/replacement behavior.
- `/goal copy` is implemented and tested.
- Lifecycle changes use `planGoalTransition()`.
- Runtime persistence writes and replays `usage` entries safely.
- Recovery handles provider errors and context overflow without unsafe continuation.
- Status output explains recovery attention.
- Existing continuation safety, stale queued work, budget behavior, and prompt fidelity tests pass.
- `npm run verify` passes.

Write the audit result in the final implementation response; do not add a separate audit file unless the user asks.

- [ ] **Step 4: Inspect final diff for accidental comparison-code drift**

Run:

```bash
git diff --stat HEAD~7..HEAD
git diff HEAD~7..HEAD -- package.json src README.md docs/agent-instructions prompts skills scripts | less
```

Check for these risks:

- Status spelling accidentally changed from `budget_limited` to `budgetLimited`.
- Current XML prompt markers were removed or weakened.
- Continuation messages became visible when they should remain hidden.
- File-store persistence was introduced.
- Fitch's large module tree was copied wholesale instead of targeted modules.
- Recovery pause marks a goal complete.
- `verify` requires real provider credentials or network.

- [ ] **Step 5: Fix any regression with focused tests**

If a check fails, fix only the related regression and rerun:

```bash
npm test -- <focused test files>
npm run verify
```

Expected: focused tests and full verify pass.

- [ ] **Step 6: Final commit if fixes were needed**

```bash
git add <changed-files>
git commit -m "fix: complete goal reliability regression pass"
```

If no fixes were needed after Task 2, do not create an empty commit.

## Phase Verification

- [ ] Package smoke passes: `npm run smoke:package`
- [ ] High-risk tests pass: `npm test -- src/runtime.test.ts src/stale-queued-work-guard.test.ts src/queued-goal-work.test.ts src/recovery.test.ts src/goal-transition.test.ts src/goal-persistence.test.ts`
- [ ] Full verification passes: `npm run verify`
- [ ] README, changelog, and agent instruction docs match implemented behavior
- [ ] Final acceptance audit has concrete evidence for every design criterion
- [ ] Stop for human review if `npm run verify` requires credentials, network, or external provider access
