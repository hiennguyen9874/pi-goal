---
name: pi-goal-writer
description: Drafts and reviews strong /goal objectives for pi-goal. Use when the user asks to write, improve, audit, or meta-prompt a long-running agent goal with clear success criteria, verification, constraints, iteration policy, and blocked stop conditions.
---

# Pi Goal Writer

## Purpose

Write `/goal` prompts that are fit for persistent autonomous work. A goal is not a bigger ordinary prompt; it is a completion contract. The agent will keep using it to decide what to do next and whether it can honestly stop, so the goal must define the desired end state, the evidence that proves it, the constraints that must remain true, and when to stop as blocked instead of drifting.

## Core rule

Never produce a vague goal such as "make this better," "finish the feature," or "improve the codebase." Turn the user's rough intent into a goal with auditable completion criteria.

A strong goal includes six parts:

1. **Outcome** — what must be true when the work is done.
2. **Verification surface** — tests, commands, benchmark output, report, artifact, diff audit, PR state, screenshots, logs, or other concrete evidence.
3. **Constraints** — what must not regress or be changed.
4. **Boundaries** — files, directories, tools, systems, data sources, or permissions the agent may or may not use.
5. **Iteration policy** — how the agent should choose the next action after each attempt.
6. **Blocked stop condition** — when the agent should stop honestly, with evidence and the next needed input, instead of continuing blindly.

## Workflow

1. Gather context before drafting when the task depends on a repository, issue, test suite, benchmark, PR, design, or external documentation. Read the relevant files or sources instead of inventing the verification surface.
2. Ask at most three clarifying questions only when missing information changes the goal contract. Prefer making safe assumptions explicit when the user is trying to move quickly.
3. Draft the goal as a single pasteable Pi `/goal` command, then include a short rationale or checklist showing how the six parts are covered.
4. For high-stakes or ambiguous work, provide two options: a narrower goal that is safer to execute and a broader goal that delegates more discovery to the agent. Recommend one.

## Goal template

Use this shape unless the user asks for a different format:

```text
/goal <desired end state>, verified by <specific evidence>, while preserving <constraints>. Use <allowed inputs/tools/scope> and avoid <forbidden scope>. Between iterations, <how to choose the next best action and what to re-check>. If blocked or no defensible path remains, stop with <evidence gathered, attempted paths, blocker, and next input needed>.
```

For Pi token budgets:

```text
/goal --tokens 50k <same goal contract>
```

## Writing standards

Make the goal self-contained. It should survive context compaction and continuation turns. Include exact command names when known, but do not invent commands. Say "run the relevant project checks identified in AGENTS.md/package scripts" only when exact commands are unknown and the agent can inspect them.

Make completion evidence-based. The goal should require the agent to inspect real artifacts before declaring success: files changed, tests passed, benchmark numbers, rendered screenshots, logs, PR checks, or a written audit. Do not let "tests pass" be the only evidence unless the tests actually cover every requirement.

Bound the scope. Name excluded directories or behaviors when important, such as "do not rewrite CLI user-facing output," "do not change public API behavior," or "do not touch generated files except via the generator."

Preserve honesty under uncertainty. If evidence may be unavailable, require a final report that separates confirmed findings, approximate/proxy evidence, blocked claims, and remaining uncertainty.

Prefer concrete stop language: "If blocked, stop with the exact blocker and what would unlock progress." Avoid weak endings like "do your best."

## Review checklist

Before returning a goal, verify it answers:

- Can the agent tell when it is done?
- Can the user independently audit that completion claim?
- Are regressions and forbidden approaches named?
- Does the goal allow iteration without inviting unlimited drift?
- Does it define what to do when tests, credentials, network, data, or product decisions block progress?
- Is it pasteable as one `/goal` command?

## Examples

Weak:

```text
/goal improve logging
```

Strong:

```text
/goal Implement structured runtime logging, verified by targeted logger tests, the full project check/type/test suite, and final audits showing no production console.* calls outside approved CLI/UI/logger-sink exceptions. Preserve existing operator-visible console behavior, avoid logging secrets or credentials, and keep the logger generic rather than error-only. Between iterations, inspect the diff and audit remaining catch paths before deciding the next change. If blocked, stop with the unverified requirement, evidence gathered, and the next input needed.
```

Weak:

```text
/goal fix flaky checkout test
```

Strong:

```text
/goal Diagnose and either fix or conclusively characterize the flaky checkout test, verified by a reliable local reproduction or an evidence-backed failure analysis plus the relevant test command passing when a fix is made. Preserve public checkout behavior and avoid broad timing hacks unless the evidence shows timing is the root cause. Between iterations, record the hypothesis tested, command output, and next most likely cause. If the flake cannot be reproduced or no safe fix remains, stop with attempted reproductions, logs, suspected causes, and the missing evidence needed.
```
