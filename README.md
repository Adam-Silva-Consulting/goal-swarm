# goal-swarm

> Multi-agent AI coding orchestration that pays **$0** in API costs.

`goal-swarm` coordinates Claude Code, Codex CLI, Gemini CLI, Gemini Antigravity, and Ollama-served models as a **Coordinator / Specialist / Verifier** swarm — all through your existing harness subscriptions. The harness handles OAuth. The harness pays the model. You pay $0 in API costs.

Plus cross-model verification: every Specialist's diff is gated by a Verifier running a different model. Catches false positives that single-model self-review misses, without doubling your spend.

## Why this is different

| Framework | Where the models run | API cost per 4-hour session* |
|-----------|---------------------|------------------------------|
| LangGraph | Your OpenAI / Anthropic API key | $80 - $200 |
| CrewAI | Your OpenAI API key | $60 - $150 |
| AutoGen | Your OpenAI / Anthropic API key | $80 - $200 |
| **goal-swarm** | **Your Claude Code / ChatGPT / Gemini subscription** | **$0** |

*Mid-range estimate for a feature build with ~50K tokens in / out across the swarm.

The savings compound. A team running 5 swarms a day saves **$1,500 - $5,000 / month** on API bills alone. And because the Verifier runs on a different model than the Specialist, you catch more bugs than you would with any single model burning more tokens.

## How it works

`goal-swarm` is a **protocol**, not a framework. Five stages:

1. **Stage 0 — Planning Council**. Probes installed CLIs, fans the same prompt out to every available LLM, returns side-by-side recommendations. Plan-mode lock; no writes. You approve before anything ships.
2. **Stage 1 — Goal file**. `.goal-swarm/goals/g-{slug}.md` with objective, verifiable acceptance criteria, hard iteration cap.
3. **Stage 2 — Decompose** into Coordinator / Specialist / Verifier tasks. Flat producer-consumer (no `dependsOn` graphs — those cause infinite handoff loops per the 2026 research).
4. **Stage 3 — Dispatch** each Specialist into a git worktree with a gossip preamble. Workers append events to a shared JSONL blackboard so they can see each other in real time.
5. **Stage 4 — Coordinator loop** with a hard **`--max-iterations 25` Ralph Wiggum kill switch** (prevents runaway token spend from CLI token-counting leaks).
6. **Stage 5 — Verifier gate, sequential merge, archive**. Verifier on a different model approves Specialist diffs before any merge. Tests run on the integration branch.

See `SKILL.md` for the full protocol.

## Quickstart

```bash
# Install
git clone https://github.com/Adam-Silva-Consulting/goal-swarm ~/.claude/skills/goal-swarm

# Symlink CLI (optional but recommended)
ln -s ~/.claude/skills/goal-swarm/scripts/goal-swarm.js ~/.local/bin/goal-swarm
chmod +x ~/.local/bin/goal-swarm

# Check your harness setup
goal-swarm doctor

# Run a swarm
cd /path/to/your/repo
goal-swarm plan "Add rate limiting to the API with tests and docs"
# Review the council recommendations. Approve.
goal-swarm start g-2026-05-15-rate-limit
# Hand the goal file to the recommended Coordinator (Claude / Codex / Gemini)
# Watch the swarm in another terminal:
goal-swarm watch g-2026-05-15-rate-limit
# When done:
goal-swarm archive g-2026-05-15-rate-limit
```

### Prerequisites

- Node.js 16+ (zero npm dependencies, pure stdlib)
- At least one supported coding harness installed and authenticated:
  - [Claude Code](https://claude.com/claude-code)
  - [Codex CLI](https://github.com/openai/codex)
  - [Gemini CLI](https://github.com/google-gemini/gemini-cli)
  - Or any [Ollama](https://ollama.com)-served model (Kimi K2, GLM-5, Qwen3-coder, etc.)

Run `goal-swarm doctor` after install. Roster gracefully degrades when a CLI is missing.

## The hard rules

The 2026 research consensus on what kills multi-agent swarms in production is brutal. `goal-swarm` codifies the guards:

| Rule | Reason |
|------|--------|
| Verifier MUST be a different harness/model than the Specialist | Self-verification is the #1 source of false-positive completion |
| No `dependsOn` graphs | Complex graph routing triggers infinite handoff loops |
| MCP for tools, A2A only for cross-vendor peer discovery | Conflating them inflates context windows |
| Hard `--max-iterations 25` kill switch | Prevents runaway token spend from CLI token-counting leaks |
| Pre-flight repo scan injected into council prompts | Whole-repo context inflates latency, cost, and hallucination |
| Git worktree isolation per Specialist | Concurrent agents share filesystem = merge-conflict hotspots |

## Sponsor goal-swarm

This project is built by Adam Silva Consulting and supported by the community. **60% of net donation revenue is shared quarterly with active contributors** weighted by accepted-PR count. The framework is in `CONTRIBUTING.md`.

| Tier | Per month | Perks |
|------|-----------|-------|
| [Coffee](https://buy.stripe.com/4gMdR1arFeTB3bAaJ3dnW02) | $5 | Listed in `THANKS.md` |
| [Power User](https://buy.stripe.com/dRm5kvczNcLtdQe5oJdnW03) | $25 | Same + private Discord access |
| [Team](https://buy.stripe.com/cNifZ9czN26PdQeg3ndnW04) | $100 | Same + monthly office hours |
| [Sponsor](https://buy.stripe.com/14AaEP6bpbHpcMa18tdnW05) | $500 | Logo on README + quarterly social shout-out |
| [Founding Sponsor](https://buy.stripe.com/6oU5kv8jx4eX3bAdVfdnW06) | $5,000 once | Co-branded launch announcement + logo |

GitHub Sponsors application pending; the button will appear on this repo once approved.

## Bundled scripts

| Script | Purpose |
|--------|---------|
| `scripts/swarm-event.js` | Append-only JSONL blackboard CLI. `log` / `read` / `ask` / `watch`. |
| `scripts/council-fanout.js` | Stage 0 multi-LLM planning council. Probes installed CLIs + fans out + captures responses. |
| `scripts/goal-swarm.js` | Top-level CLI. `plan` / `start` / `status` / `watch` / `archive` / `doctor`. |

All three are pure Node, zero npm dependencies.

## IDE integration

VS Code + Antigravity extension lives in `ide-extension/`. Adds:

- A status-bar **Swarm** button
- `goal-swarm: Plan` command in the command palette
- Side panel that renders council recommendations with GO / Modify / Reject buttons

Build + install:

```bash
cd ide-extension
npm install
npx vsce package
code --install-extension goal-swarm-*.vsix    # or `antigravity --install-extension ...`
```

## Templates

| Template | Purpose |
|----------|---------|
| `templates/goal-file.md` | Skeleton goal file |
| `templates/task-file.md` | Skeleton task file with role + harness + worktree fields |
| `templates/gossip-preamble.md` | Drop-in event-protocol block prepended to every dispatched sub-task |
| `templates/council-prompt.md` | The structured prompt fanned out to every council member |

## Config

The roster is configurable via:

1. `--config <path>` flag
2. `.goal-swarm/config.json` in the current repo
3. `~/.goal-swarm/config.json` user-global
4. `config.example.json` bundled here (fallback)

Ollama entries are commented out by default; uncomment after pulling models locally.

## Contributing

We share the upside. See `CONTRIBUTING.md` for:

- The revenue-share framework (60% of net donations to active contributors quarterly)
- The bounty workflow (`bounty` label on issues, $50-500 per merged PR)
- PR standards (every PR must pass the same Verifier gate the protocol enforces)
- Local development + testing

## License

MIT. See `LICENSE`.

## Built by Adam Silva Consulting

`goal-swarm` is open-source infrastructure from [Adam Silva Consulting](https://www.adamsilvaconsulting.com). We build the protocols that make AI agents work in production. If your team needs help wiring this into your stack — or you want a private consulting engagement on top — [reach out](https://www.adamsilvaconsulting.com/contact).
