# Changelog

## Unreleased

### Goal Reliability Upgrade

- Correct package metadata and validation scripts.
- Document the current `pi-goal` command, tool, lifecycle, budget, and continuation behavior.
- Added goal-writing skill and `/goal:create` prompt template.
- Added explicit `create_goal.replace_existing` support.
- Added `/goal copy`.
- Added transition-planned lifecycle changes.
- Added replay-safe runtime usage entries.
- Added provider/context-overflow recovery attention.
- Added package smoke validation.
- Fixed `/goal resume` behavior for suppressed active goals and budget-limited goals.
- Added a one-time warning when goal continuation is blocked because mutating tools are unavailable.
- Strengthened compact continuation guardrails to preserve objective scope and require evidence before completion.
- Cancelled queued continuations unless the matching current goal is still active.
- Improved duplicate `create_goal` guidance for agents.
