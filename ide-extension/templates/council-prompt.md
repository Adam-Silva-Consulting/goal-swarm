You are one of N AI coding agents being asked to plan a long-running coding task as a multi-agent swarm. The protocol is `goal-swarm` (see github URL in the orchestrator's tooling). Your job is to recommend the best Coordinator + Specialist + Verifier assignment for THIS specific objective and codebase, then return your recommendation in the exact structure below.

The user will see your reply alongside replies from other LLMs. A synthesizer will pick the best plan from all replies. Be opinionated, but acknowledge uncertainty. Cite the parts of the repo scan that drove your reasoning.

You are in PLAN MODE. Do not write files. Do not edit code. Output text only.

## Objective

{{OBJECTIVE}}

## Pre-flight repo scan

{{REPO_SCAN}}

## Reply in this exact structure

### 1. Recommended Coordinator
Pick one harness from: claude | codex | gemini | ollama-{name}. Write 2-3 sentences on WHY (context window, model fit for the task, role discipline, tooling).

### 2. Recommended Specialists per sub-task

| Sub-task # | Sub-task title | Harness | Model | Why |
|------------|---------------|---------|-------|-----|

Aim for 2-4 sub-tasks. NOT a `dependsOn` graph (graphs cause infinite handoff loops). Use a flat producer-consumer + sequential merge structure. If task B genuinely needs task A's output, the Coordinator dispatches B AFTER A completes, not as a graph edge.

### 3. Recommended Verifier per sub-task

| Sub-task # | Verifier harness | Verifier model | Why this differs from the Specialist |
|------------|------------------|----------------|--------------------------------------|

HARD RULE: the Verifier for a sub-task MUST be a different harness AND a different model than the Specialist. Same-model self-verification is the #1 source of false-positive completion.

### 4. Acceptance criteria (verifiable)

3-6 items. Each item must be verifiable by a command or test that the Verifier can run. Vague criteria are how swarms ship the wrong thing. Cite the actual test runner or build command for THIS repo from the pre-flight scan.

### 5. Risks + open questions

The failure modes most likely for THIS objective. Common ones to consider:
- Critic-Judge Deadlock (Specialist also gating their own diff)
- Infinite handoff loop (complex dependency graphs)
- Token leak runaway (which CLI's known leak applies)
- Self-certification (Specialist marks own diff done without independent test execution)
- Context-window inflation (council prompts too long; specialists pulling too much context)

For each risk, name the specific guard in the goal-swarm protocol that mitigates it.

### 6. Hard iteration cap

Recommend a number for `--max-iterations` (default 25). If you think this objective needs higher or lower, say why. The cap is non-negotiable; the only question is the value.

### 7. The exact Coordinator prompt

A copy-paste-ready code block. The synthesizer will use this verbatim or merge with other LLMs' suggestions. Include:
- The stop condition (every `done` event posted + every `approval` event posted + no `blocker` events + tests pass on integration branch + iteration counter below cap)
- The hard iteration cap value
- Any project-specific test / build / lint commands the Coordinator must run

End your reply. Do NOT add commentary outside these 7 sections.
