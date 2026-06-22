# Goal Reliability Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `pi-goal` into a reliability-focused goal extension with stronger packaging, onboarding, replacement semantics, transition discipline, replay-safe runtime usage, recovery handling, and smoke validation.

**Architecture:** Keep current `src/` as the base because it already has robust continuation, stale-work, budget, prompt, and test coverage. Add targeted seams for transitions, persistence, accounting, recovery, and runtime state rather than cloning Fitch's many-file architecture. Preserve session-journal persistence and extend it with monotonic runtime usage entries.

**Tech Stack:** TypeScript, Vitest, Node scripts, Pi extension APIs from `@earendil-works/pi-coding-agent`, session custom entries, packaged prompts/skills.

---

## Assumptions

- It is acceptable to update Pi peer dependency versions when implementation proves a newer API is required, but each phase should prefer compatibility with current APIs where practical.
- `docs/plans/2026-06-22-goal-reliability-upgrade/design.md` is the approved design and remains the source of product intent.
- Comparison implementations are local reference material only; copy concepts and small text templates intentionally, but keep current status names (`budget_limited`) and current robust continuation behavior.

## Phases

1. [Phase 1: Package Hygiene and Validation Foundation](phase-1.md)
2. [Phase 2: Onboarding Bundle and Tool/Command UX](phase-2.md)
3. [Phase 3: Transition Planner and Effects Seam](phase-3.md)
4. [Phase 4: Runtime Usage Persistence and Replay Hardening](phase-4.md)
5. [Phase 5: Recovery Machine and Status Attention](phase-5.md)
6. [Phase 6: Runtime Integration Cleanup](phase-6.md)
7. [Phase 7: Smoke Gate and Final Regression Pass](phase-7.md)
