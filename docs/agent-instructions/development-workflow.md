# Development Workflow

Read When: you install dependencies, add packages, run or fix tests, or need TypeScript/code conventions.

## Commands

| Task | Command |
|---|---|
| Install dependencies | `npm install` |
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |

Inferred from `package.json` scripts. No build, lint, format, or typecheck scripts are defined.

## Package Manager

npm. The lockfile is `package-lock.json`.

## Peer Dependencies

This package expects runtime peers provided by pi:
- `@earendil-works/pi-ai` (>=0.74.0)
- `@earendil-works/pi-coding-agent` (>=0.74.0)
- `@earendil-works/pi-tui` (*)
- `@sinclair/typebox` (*)

Dev dep `@earendil-works/pi-coding-agent` is used for type imports.

## Test Configuration

Tests use vitest, configured in `vitest.config.ts`. The include glob in config is `test/**/*.test.ts`, but tests are co-located in `src/*.test.ts`. If `npm test` reports "No test files found", the config glob may need updating.

Tests import from `node:test` and `node:assert/strict`, which vitest handles.

## TypeScript Configuration

- Target: ESNext
- Module: ESNext, bundler resolution
- `strict: true`, `noEmit: true`, `skipLibCheck: true`
- Includes: `src/**/*.ts`, `test/**/*.ts`

No build output. Pi loads source directly as an extension.

## Code Conventions

### Source Structure
- All source is flat under `src/`, no nested directories.
- Tests are co-located: `src/foo.test.ts` tests `src/foo.ts`.
- Each file exports a focused module: types + logic for one concern.

### Imports
- Use `.ts` extensions in import paths: `import { x } from "./state.ts"`.
- Peer deps are imported without path: `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"`.

### State Management
- Goal state is `GoalState` in `state.ts` (versioned, immutable-style with `transitionGoal`).
- Persistence uses pi's `appendEntry` with a custom entry type `ENTRY_TYPE = "pi-goal"`.
- Restore reconstructs state from the session branch on extension load.

### Patterns
- Factory functions return objects with closures (see `createStaleQueuedWorkGuard`).
- Interface segregation: internal interfaces (`GoalCommandHost`, `GoalToolHost`) let tests inject mock hosts.
- Continuation suppression logic: `shouldScheduleContinuation()` gates when hidden turns fire.

## Gotchas

- The vitest config glob `test/**/*.test.ts` does not match the actual test location `src/*.test.ts`.
- The `noEmit` tsconfig means there's no compile step; CI/CD would validate via `npm test`.
- `node:crypto` (`randomUUID`) is used — this is available in Node 19+.
