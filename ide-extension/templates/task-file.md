---
goalId: {{GOAL_ID}}
taskId: {{TASK_ID}}
role: {{ROLE}}             # coordinator | specialist | verifier
harness: {{HARNESS}}        # claude | codex-goal | codex-exec | gemini-yolo | gemini-panel | ollama-{name}
model: {{MODEL}}            # opus-4.6 | gpt-5.5 | gemini-3-pro | kimi-k2 | ...
worktree: {{WORKTREE_PATH}} # always set; e.g. .worktrees/g-foo/task-2
verifies: {{VERIFIES_TASK}} # only for verifier role; ID of the task whose diff this reviews
---

# {{TITLE}}

## What this task accomplishes

One paragraph. Should be carve-out-able from the parent goal.

## Inputs

What context this task needs. Files, prior task outputs, environment variables.

## Deliverables

What must exist when this task is done. Files, tests, events posted.

## Verification (filled by the Coordinator, run by the Verifier)

The deterministic checks the Verifier must run before approving the Specialist's diff. Example:

```bash
npm test -- --testPathPattern=rate-limit
npx tsc --noEmit
git diff --stat origin/main...HEAD
```

If any check fails the Verifier posts a `rework` event with specifics. Specialist must address before re-requesting approval.

## Cross-harness coordination

This task participates in the swarm event log at `.goal-swarm/active/{{GOAL_ID}}.events.jsonl`. See `templates/gossip-preamble.md` for the protocol — that preamble will be prepended to your prompt automatically by the Coordinator dispatcher.

## Out of scope for this task

Things that look related but belong to a different task or a future goal.
