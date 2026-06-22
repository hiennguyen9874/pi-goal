# Phase 1: Package Hygiene and Validation Foundation

**Goal:** Make the package accurately describe `pi-goal`, remove obvious scaffold residue, and add a typecheck/verify foundation before behavior changes begin.

**Tasks:** 3 related tasks only.

## References

- Current package: `package.json`
- Current project instructions: `AGENTS.md`
- Current docs: `docs/agent-instructions/overview.md`, `docs/agent-instructions/architecture.md`
- Comparison package metadata: `fitchmultz-pi-codex-goal/package.json`, `code-yeongyu-pi-goal/package.json`
- Comparison package-manifest test pattern: `fitchmultz-pi-codex-goal/test/package-manifest.test.ts`

### Task 1: Package Metadata and Scripts

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `src/package-manifest.test.ts`

- [ ] **Step 1: Write the failing package manifest test**

Create `src/package-manifest.test.ts` with these assertions. Follow the existing test style in `src/state.test.ts`: `node:test` plus `node:assert/strict`.

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function readPackageJson() {
  return JSON.parse(readFileSync("package.json", "utf8")) as {
    name?: string;
    description?: string;
    keywords?: string[];
    files?: string[];
    pi?: { extensions?: string[]; prompts?: string[] };
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

test("package metadata describes pi-goal", () => {
  const pkg = readPackageJson();

  assert.equal(pkg.name, "pi-goal");
  assert.match(pkg.description ?? "", /goal/i);
  assert.doesNotMatch(pkg.description ?? "", /hashline/i);
  assert.ok(pkg.keywords?.includes("goal"));
  assert.ok(pkg.keywords?.includes("pi-extension"));
  assert.deepEqual(pkg.pi?.extensions, ["./src/index.ts"]);
});

test("package validation scripts are available", () => {
  const pkg = readPackageJson();

  assert.equal(pkg.scripts?.test, "vitest run");
  assert.equal(pkg.scripts?.typecheck, "tsc --noEmit");
  assert.equal(pkg.scripts?.verify, "npm run typecheck && npm test");
  assert.ok(pkg.devDependencies?.typescript);
});

test("package no longer ships unused hashline runtime dependencies", () => {
  const pkg = readPackageJson();

  assert.equal(pkg.dependencies?.diff, undefined);
  assert.equal(pkg.dependencies?.["file-type"], undefined);
  assert.equal(pkg.dependencies?.["xxhash-wasm"], undefined);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/package-manifest.test.ts`

Expected: FAIL because `package.json` still contains the hashline description, lacks `typecheck`/`verify`, lacks `typescript`, and lists unused dependencies.

- [ ] **Step 3: Update package metadata and scripts**

Use `code-yeongyu-pi-goal/package.json` and `fitchmultz-pi-codex-goal/package.json` as wording references, but keep current package name and current extension entry.

Required `package.json` changes:

```json
{
  "description": "Persistent goal tracking for pi with long-running objective continuations, budgets, and completion auditing.",
  "keywords": [
    "pi-package",
    "pi",
    "pi-extension",
    "coding-agent",
    "extension",
    "goal",
    "goals",
    "persistent-goals",
    "long-running-tasks"
  ],
  "files": [
    "src",
    "docs",
    "README.md",
    "CHANGELOG.md",
    "LICENSE"
  ],
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "verify": "npm run typecheck && npm test"
  }
}
```

Remove the scaffold runtime dependencies if no source/test import uses them:

```bash
npm uninstall diff file-type xxhash-wasm
npm install --save-dev typescript
```

Expected package-lock result: `package-lock.json` is updated by npm and still resolves existing Vitest/dev dependencies.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- src/package-manifest.test.ts`

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/package-manifest.test.ts
git commit -m "chore: fix pi-goal package metadata"
```

### Task 2: README and Changelog Baseline

**Files:**
- Create: `README.md`
- Create: `CHANGELOG.md`
- Modify: `src/package-manifest.test.ts`

- [ ] **Step 1: Extend the manifest test for docs presence**

Append this test to `src/package-manifest.test.ts`:

```ts
test("package ships user-facing documentation", () => {
  const pkg = readPackageJson();
  const readme = readFileSync("README.md", "utf8");
  const changelog = readFileSync("CHANGELOG.md", "utf8");

  assert.ok(pkg.files?.includes("README.md"));
  assert.ok(pkg.files?.includes("CHANGELOG.md"));
  assert.match(readme, /\/goal <objective>/);
  assert.match(readme, /budget_limited/);
  assert.match(readme, /get_goal/);
  assert.match(changelog, /Goal Reliability Upgrade/);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm test -- src/package-manifest.test.ts`

Expected: FAIL because `README.md` and `CHANGELOG.md` do not exist yet.

- [ ] **Step 3: Write README**

Create `README.md`. Use `docs/agent-instructions/overview.md` for the domain model and `fitchmultz-pi-codex-goal/README.md` only as packaging inspiration. The README must include these sections:

```md
# pi-goal

Persistent goal tracking for Pi: `/goal` creates one long-running objective, hidden continuations keep work moving, and `update_goal` marks completion only after an evidence-backed audit.

## Commands

| Command | Effect |
|---|---|
| `/goal <objective>` | Create or replace the current goal after confirmation. |
| `/goal <objective> --budget 12k` | Create a goal with a token budget. |
| `/goal` or `/goal status` | Show current goal state. |
| `/goal pause` | Pause automatic continuation. |
| `/goal resume` | Resume a paused goal. |
| `/goal clear` | Clear the current goal. |
| `/goal statusbar [on|off]` | Toggle footer status display. |

## Lifecycle States

`active`, `paused`, `budget_limited`, `complete`, and `cleared`.

## Model Tools

`get_goal`, `create_goal`, and `update_goal`. `update_goal` only accepts `status: "complete"` and should be called only after every requirement is verified.

## Continuations and Safety

Describe hidden continuations, stale queued work cancellation, no-progress suppression, and budget-limit steering using the language from `docs/agent-instructions/overview.md`.
```

- [ ] **Step 4: Write changelog baseline**

Create `CHANGELOG.md` with:

```md
# Changelog

## Unreleased

### Goal Reliability Upgrade

- Correct package metadata and validation scripts.
- Document the current `pi-goal` command, tool, lifecycle, budget, and continuation behavior.
```

- [ ] **Step 5: Run tests**

Run: `npm test -- src/package-manifest.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add README.md CHANGELOG.md src/package-manifest.test.ts
git commit -m "docs: document pi-goal package"
```

### Task 3: Baseline Verification Gate

**Files:**
- Modify: `package.json`
- Modify: `src/package-manifest.test.ts`

- [ ] **Step 1: Add a test that verify script remains phase-1 safe**

Keep the phase-1 `verify` script intentionally narrow until the smoke script is added in Phase 7. Add this assertion to the existing validation script test if it is not already exact:

```ts
assert.equal(pkg.scripts?.verify, "npm run typecheck && npm test");
```

- [ ] **Step 2: Run full verification**

Run: `npm run verify`

Expected: PASS. This runs `npm run typecheck` and `npm test`.

- [ ] **Step 3: Commit if any adjustments were needed**

```bash
git add package.json package-lock.json src/package-manifest.test.ts
git commit -m "chore: add baseline verify script"
```

If Step 2 passed without new changes, do not create an empty commit.

## Phase Verification

- [ ] Focused manifest tests pass: `npm test -- src/package-manifest.test.ts`
- [ ] Typecheck passes: `npm run typecheck`
- [ ] Full baseline verify passes: `npm run verify`
- [ ] `package.json` no longer contains `hashline` wording
- [ ] Stop for human review if removing dependencies breaks install or typecheck
