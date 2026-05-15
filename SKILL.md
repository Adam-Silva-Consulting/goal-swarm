---
name: goal-swarm
description: Use when the user wants multiple AI coding agent harnesses — Claude Code, Codex CLI, Gemini CLI, Gemini Antigravity, plus optional Ollama-served models (Kimi K2, GLM-5, Qwen3-coder, etc.) — to collaborate on one long-running goal as a Coordinator / Specialist / Verifier swarm. Any harness can be the orchestrator. The skill runs a Stage 0 planning council across every installed LLM CLI in plan-mode first; each LLM explains its reasoning and proposes a Coordinator + Specialist + Verifier assignment; results are synthesized and reported to the user for approval BEFORE any code edits. Trigger phrases — "swarm on X", "use multiple agents for X", "have claude codex gemini collab on X", "/goal-swarm X", "coordinate agents on X", "multi-agent task X", "launch a swarm for X", "use council to plan X". Also use when a task has 2+ parallel sub-tasks runnable in isolated worktrees, would exceed 30 min wall clock on any one harness, or benefits from cross-model verification. Do NOT use for single-file edits or pure-discovery work — those stay in the current session.
---

# /goal-swarm — Multi-Harness Coordinator + Specialist + Verifier Swarm

Coordinate multiple AI coding harnesses on one long-running goal via the dominant 2026 design pattern: strict separation of **Coordinator** (planning, delegation, gate), **Specialist** (implementation), and **Verifier** (independent review + test). The skill is a protocol, not a framework; harnesses keep their own loops, the skill is the shared language.

## What this skill ships

| File | Purpose |
|------|---------|
| `scripts/swarm-event.js` | Blackboard CLI. Append-only JSONL log at `.swarm/state.jsonl` (per repo) or `.goal-swarm/active/{goalId}.events.jsonl` (per goal). Pure Node, zero deps. |
| `scripts/council-fanout.js` | Stage 0 planning council. Probes installed LLM CLIs, fans the same prompt out in parallel, captures structured recommendations. |
| `scripts/goal-swarm.js` | Terminal CLI wrapper. Subcommands `plan`, `start`, `status`, `watch`, `archive`. |
| `templates/` | Goal file, task file, gossip preamble, council prompt — all drop-in. |
| `config.example.json` | Roster (claude / codex / gemini today; Ollama entries commented for v2). |
| `LICENSE` | MIT. |
| `README.md` | GitHub-facing landing. |

Three surfaces invoke the same flow:

- **Terminal:** `goal-swarm plan "<objective>"` after symlinking the entry script into PATH
- **IDE button (shipped):** VS Code / Antigravity extension in `ide-extension/` adds a status-bar "Swarm" button + 6 commands in the palette + a side panel webview. Build + install via `cd ide-extension && npx @vscode/vsce package && code --install-extension goal-swarm-*.vsix` (or `antigravity --install-extension ...`)
- **Claude Code skill activation:** typing any trigger phrase activates this skill via the description above

## Why it exists

Claude Code's `/goal`, Codex CLI's `/goal`, and Gemini CLI's YOLO loop are all long-run primitives that don't talk to each other. Running a big task on one wastes the others; running them in parallel without coordination wastes their results.

The 2026 research consensus is clear on what works (Coordinator / Specialist / Verifier separation, worktree isolation, verification gates, JSONL blackboard, MCP for tools + A2A for discovery) and what fails (critic-judge deadlock, infinite handoff loops, complex `dependsOn` graphs, agents that hold both suggestion and gate authority).

`goal-swarm` packages those findings into a shippable protocol.

## The 5-stage flow

### Stage 0 — Planning Council (plan-mode lock)

Triggered when the skill is invoked with a user objective. Nothing writes to disk in Stage 0. The output is a text report only. The user must approve before Stage 1 proceeds.

**Roster** (from `config.example.json`, overridable via `.goal-swarm/config.json` per repo or `~/.goal-swarm/config.json` user-global):

```jsonc
{
  "roster": [
    { "name": "claude",  "cmd": "claude -p"  },
    { "name": "codex",   "cmd": "codex exec" },
    { "name": "gemini",  "cmd": "gemini -p"  }
    // Future / opt-in:
    // { "name": "kimi-k2", "endpoint": "http://localhost:11434/api/chat", "model": "kimi-k2:latest" },
    // { "name": "glm-5",   "endpoint": "http://localhost:11434/api/chat", "model": "glm:5.1-air" },
    // { "name": "qwen-c",  "endpoint": "http://localhost:11434/api/chat", "model": "qwen3-coder:14b" }
  ]
}
```

**Council prompt** (from `templates/council-prompt.md`, filled with the user objective). Each LLM answers in this structure:

1. **Coordinator** — which harness should drive the swarm + a 2-3 sentence rationale (context window, model fit, tooling, role discipline)
2. **Specialists** — which harness for each sub-task (worker assignment table)
3. **Verifier** — which harness reviews diffs before done (must differ from the Specialist that produced each diff)
4. **Decomposition** — 2-4 sub-tasks (NOT a `dependsOn` graph; flat producer-consumer + sequential branch merging per the research)
5. **Acceptance criteria** — verifiable by a command or test
6. **Risks** — open questions + the failure modes most likely for this objective (critic-judge deadlock, infinite handoff, missing verification)
7. **The exact prompt to send to the Coordinator** — copy-paste-ready code block

**Synthesis report to user:**

- Each LLM's recommendation, verbatim and attributed
- Side-by-side compare of Coordinator picks
- Synthesized final plan with "council settled on X because Y"
- The final Coordinator prompt
- All risks flagged
- Approval gate: GO / modify / reject

### Stage 1 — Goal file (after user GO)

Write `.goal-swarm/goals/g-{slug}.md` from the synthesized plan. Template: `templates/goal-file.md`. Required fields:

- Objective
- Acceptance criteria (verifiable)
- Constraints
- Out of scope
- Hard iteration kill switch (default `--max-iterations 25` — the "Ralph Wiggum Loop" stop condition; prevents runaway token spend and infinite retry caused by native token leaks or nested-stringify bugs)

### Stage 2 — Decompose into Coordinator + Specialist + Verifier tasks

Write each task file to `.goal-swarm/tasks/g-{slug}/task-{N}.md` with frontmatter:

```yaml
---
goalId: g-rate-limit
taskId: task-2
role: specialist       # coordinator | specialist | verifier
harness: codex-goal    # the dispatcher reads this
worktree: .worktrees/g-rate-limit/task-2   # always set; see Stage 3 isolation
---
```

**Hard rule on roles:** the Verifier for a task MUST be a different harness/model than the Specialist that produced its diff. Same model self-verification is cited across the research as the single largest source of false-positive completion.

**No `dependsOn` graph.** Research is explicit: complex graph-based routing triggers infinite handoff loops and cycle formation. Use a flat producer-consumer queue with sequential branch merging instead. If task B genuinely needs task A's output, the Coordinator dispatches B AFTER A completes — not as a graph edge.

### Stage 3 — Worktree isolation + dispatch with gossip preamble

For each task, the Coordinator:

1. **Creates the worktree** for the task BEFORE dispatch:
   ```bash
   git worktree add .worktrees/g-{slug}/task-{N} -b goal-swarm/g-{slug}/task-{N}
   ```
   Concurrent agents without filesystem isolation generate hotspot contention + merge conflicts. Worktrees give parallel sandboxes that share the object database without duplicating it.

2. **Injects the pre-flight repo scan** into the task body. The scan (run once per goal, cached) produces a lightweight index — `package.json`, top-level structure, recent git log, README excerpts — capped at ~2K tokens. Feeding entire repos into context inflates latency, cost, and hallucination rate. The scan is what makes the Coordinator's plan repo-aware.

3. **Prepends the gossip preamble** (`templates/gossip-preamble.md`) to every dispatched prompt. Without it workers are invisible to each other.

4. **Dispatches** to the assigned harness:

| Harness | One-shot | Long-running |
|---------|----------|--------------|
| Claude Code | `claude -p "<prompt>"` | Stay in current session, or `claude --resume <sessionId>`; built-in `/goal` evaluates the stop condition |
| Codex CLI | `codex exec "<prompt>"` | `codex exec "/goal <condition>"` (requires beta features enabled) |
| Gemini CLI | `gemini -p "<prompt>"` | `gemini --approval-mode yolo "<prompt>"` |
| Gemini Antigravity | Bridge HTTP API / panel inject | Same; Antigravity's role is usually browser / UI validation as Verifier |
| Ollama-served | `curl http://localhost:11434/api/chat ...` | Loop with the chat endpoint |
| Custom | Any shell-callable agent | Any shell-callable agent |

### Stage 4 — Coordinator loop with Ralph Wiggum kill switch

The Coordinator's long-run loop, bound by the hard iteration cap from Stage 1:

```
iter = 0
while iter < MAX_ITERATIONS:
  iter += 1
  events = swarm-event read {goalId} --since <lastReadIso>
  for unanswered question > 10 min old where addressee is stuck: post answer
  for blocker: stop, surface to user, decide whether to dispatch a fix
  if all tasks have `done` events AND no blockers AND no open questions AND verification passes:
    break
  sleep N
```

`MAX_ITERATIONS` defaults to 25, configurable per goal. This is the absolute termination condition — it prevents runaway token spend caused by token-counting leaks or nested-stringify bugs in any underlying CLI. Cited as the single most important production guardrail in the research.

### Stage 5 — Verifier gate, merge, archive

Before any Specialist's diff is honored as `done`:

1. **Verifier review event** — Coordinator dispatches a Verifier sub-task to a different harness/model. Verifier receives the diff + the original task spec + the project's test/lint/typecheck commands. Verifier posts an `approval` event (with rationale) or a `rework` event (with specifics).
2. **Tests must pass** — verification sub-task always runs `npm test` / `pytest` / `cargo test` / whatever the project uses against the merged state. Verification IS the new prompt engineering; agents systematically overrate their own code.
3. **Sequential branch merge** — once Verifier approves, Coordinator merges the worktree branch via `git merge --no-ff` into a goal-integration branch. Branches merge sequentially in done-order, NOT in parallel.
4. **Archive** — when all task branches merged + final verification on the integration branch passes, move `.goal-swarm/goals/g-{slug}.md` + task files + done files + event log into `.goal-swarm/archive/g-{slug}/` and merge the integration branch back to the user's working branch via PR or local merge (user's call).

## Cross-harness gossip protocol

The shared bus is a per-goal JSONL blackboard. Following the 2026 convention, projects can also keep a repo-root `.swarm/state.jsonl` for cross-goal observability; the per-goal log is the authoritative source for any one swarm.

**Location:** `.goal-swarm/active/{goalId}.events.jsonl` (per-goal) or `.swarm/state.jsonl` (repo-wide).

**Event types:**

| Type | When | Cross-task effect |
|------|------|-------------------|
| `status` | Heartbeat or after each material step | Others see you are alive |
| `finding` | Something other tasks should know | Others may pivot |
| `question` | You need an answer from a specific task (`--to taskId`) | Addressee must answer before completing |
| `answer` | Responding to a `question` (`--inReplyTo <ts>`) | Unblocks asker |
| `blocker` | Stuck, need Coordinator | Coordinator won't declare done |
| `pause_for_human` | Worker needs a human to perform an interactive action (paste a code, sign in via browser, click a consent button) | Coordinator suspends polling for that task until any subsequent event with `inReplyTo` referencing the pause is posted, then resumes |
| `approval` | Verifier approved a Specialist's diff | Allows Specialist's `done` to count |
| `rework` | Verifier rejected a diff | Specialist must address before `done` |
| `done` | Sub-task complete, diff merged | Coordinator verifies overall completion |

**CLI:** `scripts/swarm-event.js` — pure Node, zero npm dependencies.

```bash
node $SKILL/scripts/swarm-event.js log <goalId> <taskId> <harness> <type> "<text>" [--to taskId] [--inReplyTo ts]
node $SKILL/scripts/swarm-event.js read <goalId> [--since ISO] [--task X] [--type T] [--tail N] [--json]
node $SKILL/scripts/swarm-event.js ask <goalId> <fromTask> <toTask> "<q>" [--wait 300] [--harness X]
node $SKILL/scripts/swarm-event.js watch <goalId>
```

Full gossip preamble: `templates/gossip-preamble.md`.

## Protocol stack: MCP for tools, A2A for discovery

A clean split is essential — conflating them is a common 2026 mistake.

- **MCP (Model Context Protocol)** — used by Specialists for tool execution (filesystem, browser, database, package managers). Keeps agent context clean via progressive disclosure. If a worker needs a tool, the worker calls MCP. The skill does NOT mandate which MCPs are available; the user wires them through their own harness config.
- **A2A (Agent-to-Agent)** — reserved for peer discovery + delegation across distributed multi-vendor environments. If the Coordinator needs to delegate to a remote agent across the A2A boundary, it uses A2A. Local same-host swarm members do NOT use A2A; they use the shared JSONL blackboard.

This split is non-negotiable in the v1 design.

## The failure modes to engineer against

The research is consistent on what kills swarms in production:

1. **Critic-Judge Deadlock** — same agent holds suggestion + gate authority. Bypassed by mandating Verifier != Specialist (different harness AND different model).
2. **Infinite handoff loops** — complex `dependsOn` graphs. Bypassed by flat producer-consumer + sequential merge.
3. **Token leak runaway** — native token-counting bugs and nested-stringify cycles in some CLIs. Bypassed by the Ralph Wiggum hard iteration kill switch.
4. **Self-certification** — Specialist marks own diff `done` without independent verification. Bypassed by mandatory Verifier gate + test execution.
5. **Context-window inflation** — feeding entire repos to the council. Bypassed by pre-flight scan with retrieval-distilled lightweight index.

## Stop conditions per Coordinator

### Claude Code Coordinator

```
/goal Every task in .goal-swarm/tasks/g-{slug}/ has both an `approval` and a `done` event in the swarm log, `node $SKILL/scripts/swarm-event.js read g-{slug} --type blocker` returns nothing, every `question` has a matching `answer`, integration-branch tests pass, and iteration counter is below 25 — or stop after 25 turns
```

### Codex CLI Coordinator

```bash
codex exec "/goal Every task in .goal-swarm/tasks/g-{slug}/ has an approval + done event AND \`node $SKILL/scripts/swarm-event.js read g-{slug} --type blocker\` is empty AND tests pass on the integration branch. Run shell commands to check. Stop after 25 turns."
```

### Gemini CLI Coordinator

```bash
gemini --approval-mode yolo "
You are the Coordinator for goal {goalId}. Loop up to 25 iterations:
  1. node \$SKILL/scripts/swarm-event.js read {goalId} --since <lastReadIso>
  2. Post answers to unanswered questions if their addressee is stuck.
  3. Stop on any blocker and report to the user.
  4. For each task with a Specialist done event, dispatch the Verifier and wait for approval.
  5. After all approvals, merge worktree branches sequentially into the integration branch.
  6. Run project tests on the integration branch. If green, exit. Else dispatch rework.
  Hard cap: 25 iterations. Never exceed.
"
```

## Limits and non-goals

- **Protocol, not framework.** The skill does NOT impose a decomposition or deliberation tool beyond the council. Bring your own.
- **Wraps `/goal`, does not replace it.** Claude Code and Codex `/goal` stay as-is; Gemini and Ollama Coordinators use the loop pattern.
- **No installation management.** You need `claude`, `codex`, `gemini` (or your custom dispatchers) already installed and authenticated.
- **No cloud service.** Pure files + three small Node helpers + git worktrees. Coordination has 2-second filesystem polling latency by design.
- **No real-time pub/sub.** Workers poll the JSONL log. If you need sub-second event delivery, this is the wrong tool.

## Meta-circularity safeguard

The skill must not modify its own running files. If a swarm goal includes work that touches `.claude/skills/goal-swarm/` itself (publishing the skill to GitHub, repackaging the IDE extension, fixing the protocol scripts), the Specialist tasks must operate on a detached clone, never on the live skill directory used by the active Coordinator.

### Detached-git recipe

```bash
TMP="${TMPDIR:-/tmp}/goal-swarm-publish-$(date +%s)"
git clone "$LIVE_SKILL_DIR" "$TMP"
cd "$TMP"
# all edits, history rewrites, vsix repackages, etc. happen here
# push to the public remote from this clone, not the live one
git remote add origin "git@github.com:Adam-Silva-Consulting/goal-swarm.git"
git push origin main
```

The Coordinator must verify any task that touches the skill directory uses
the detached clone pattern before posting `approval`. A task that modifies
the live skill while another Specialist or the Coordinator is reading from
it is rejected automatically as a critic-judge deadlock risk.

## Hook caveats for Claude Code `/goal`

`/goal` is on by default in v2.1+ but blocked silently by either of:
- `disableAllHooks: true` in any settings.json file
- `allowManagedHooksOnly: true` in managed settings

If `/goal` hangs without progress, check those first. See https://code.claude.com/docs/en/goal.md.

## License

MIT. See `LICENSE`.

## References

The design is grounded in NotebookLM Ultra research across 40 sources, May 2026. Full research artifact: `output/superlm-multi-agent-orchestration-2026-05-14.md`. Top-cited sources:

- *Engineering the goal-swarm: Multi-Agent AI Coding Orchestration Patterns for the 2026 Frontier* — JSONL blackboards, Coordinator/Specialist/Verifier split, pre-flight scan
- *Agentic Engineering Patterns: Real Workflows for Dev Teams in 2026* — plan-first development, worktree isolation, automated verification loops
- *How to Run a Multi-Agent Coding Workspace (2026)* — git worktree isolation + sequential merging
- *6 Multi-Agent Orchestration Patterns for Production (2026)* — infinite handoff loops as the critical scale failure
- *ACP vs MCP vs A2A: The Complete Guide to AI Agent Protocols* — MCP for tool access, A2A for cross-vendor discovery
- *Best AI Model for Coding Agents in 2026: A Routing Guide* — role-based model routing
- *Multi-Agent Orchestration Patterns: Pattern Language 2026* — archetype composition rules to prevent cycle formation
