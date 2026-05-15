---
goalId: {{GOAL_ID}}
created: {{DATE}}
---

# {{TITLE}}

## Objective

Describe what done looks like in one paragraph. Should be bigger than one prompt but smaller than a full project. The Coordinator will use this as the north star throughout the swarm.

## Acceptance criteria

Every item must be verifiable by a command, test, or deterministic check. Vague criteria are how swarms ship the wrong thing.

- [ ] (Example) `npm test` passes 0 failures
- [ ] (Example) `npx tsc --noEmit` produces 0 errors
- [ ] (Example) Endpoint `/api/foo` returns 200 with body `{ ok: true }` for the smoke request in `tests/smoke.sh`
- [ ] (Example) New file `lib/foo.ts` exports `barFn` matching the signature in this spec

## Constraints

What the swarm must NOT change. Production paths, schemas, generated files, build configs, anything off-limits.

- (Example) Do not modify `lib/db/schema/`. Migrations only via `drizzle-kit generate`.
- (Example) Do not change any file under `app/api/billing/` — payment paths are frozen this sprint.

## Out of scope

Adjacent work that the Coordinator might be tempted to scope into the goal. Call it out so it stays a separate goal.

- (Example) Rate limiting for the public marketing site (`app/(marketing)/`). Different threat model.
- (Example) Switching from Drizzle to Prisma. Not happening here.

## Hard iteration cap

The Ralph Wiggum kill switch. Coordinator must abort if its iteration counter hits this value, regardless of progress. Prevents runaway token spend caused by CLI token-counting leaks or infinite handoff loops.

```
--max-iterations 25
```

## Hint sub-tasks (optional)

If you already have an opinion on the decomposition, list it here. The Stage 0 council may take these as seeds.

- (Example) task-1 [coordinator/claude]: draft the spec, decompose, gate
- (Example) task-2 [specialist/codex]: implement rate-limit middleware + tests
- (Example) task-3 [verifier/gemini]: independent review + run tests on integration branch

## Coordinator + Specialist + Verifier assignment (filled after Stage 0)

| Role | Harness | Model | Notes |
|------|---------|-------|-------|
| Coordinator | | | |
| Specialist (task-2) | | | |
| Verifier (task-2) | | | (MUST differ from Specialist) |

## Hard rules

- Verifier model MUST differ from Specialist model for that task.
- No `dependsOn` graphs. Flat producer-consumer; merge sequentially.
- MCP for tool use; A2A only for cross-vendor peer discovery.
- Every Specialist works in its own git worktree branch.
- Tests pass on the integration branch before any merge back to the user's working branch.
