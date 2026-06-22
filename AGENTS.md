# pi-goal

pi extension for long-running agent objectives: `/goal` command, continuation management, token budgets, and stale-work detection.

## Quick Reference

| Task | Command |
|---|---|
| Run tests | `npm test` |
| Watch tests | `npm run test:watch` |

## Mini Repo Map

| Path | Purpose |
|---|---|
| `src/index.ts` | Extension entrypoint, goal lifecycle orchestration |
| `src/commands.ts` | `/goal` CLI command parsing |
| `src/state.ts` | Goal state types, create/transition/persist logic |
| `src/tools.ts` | Model-facing tools: `get_goal`, `create_goal`, `update_goal` |
| `src/prompts.ts` | System prompt generation for goal turns |
| `src/format.ts` | Token/duration/status formatting |
| `src/stale-queued-work-guard.ts` | Detects and aborts stale queued continuations |
| `src/queued-goal-work.ts` | Context message rewriting for continuations |
| `src/queued-goal-messages.ts` | Message parsing helpers for goal continuations |
| `src/*.test.ts` | Co-located tests (vitest) |
| `package.json` | Package manifest, scripts, peerDeps |
| `tsconfig.json` | TypeScript config (ESNext, bundler, noEmit) |
| `vitest.config.ts` | Test runner config |

## Instruction Index

Read these only when the task matches scope:

| File | Read when | Contains |
|---|---|---|
| `docs/agent-instructions/overview.md` | You need domain context about pi-goal, goals, continuations, or how the extension fits into pi | Project purpose, domain concepts, user-facing commands |
| `docs/agent-instructions/development-workflow.md` | You install, add deps, run tests, or touch code conventions | Commands, conventions, TypeScript patterns |
| `docs/agent-instructions/architecture.md` | You change goal lifecycle, state transitions, continuation logic, or add/remove tools | Component map, data flow, lifecycle, boundaries |

## Critical Rules

- This is a pi extension, not a standalone app. Its entrypoint is `src/index.ts` loaded via the `pi.extensions` field in `package.json`.
- Tests are co-located with source at `src/*.test.ts`. The vitest config glob may be stale — check `vitest.config.ts` if tests aren't found.
- The `noEmit: true` tsconfig means there is no build output. Pi loads source directly.
- Never invent commands. Infer from `package.json` scripts or source.
