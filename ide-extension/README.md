# goal-swarm IDE extension

VS Code and Antigravity extension for the [goal-swarm](https://github.com/Adam-Silva-Consulting/goal-swarm) protocol.

Adds:

- A **Swarm** status-bar button (left side, click to open the planning input)
- Six commands in the palette (Cmd+Shift+P / Ctrl+Shift+P):
  - `goal-swarm: Plan a swarm` — Stage 0 planning council
  - `goal-swarm: Status of a swarm`
  - `goal-swarm: Watch event log`
  - `goal-swarm: Archive a swarm`
  - `goal-swarm: Doctor (probe roster)`
  - `goal-swarm: Open side panel`
- A webview side panel that renders the council recommendations (toggle with `goalSwarm.useTerminal: false` in settings)

## Install

### From this folder (development install)

```bash
cd ide-extension
npx @vscode/vsce package
code --install-extension goal-swarm-*.vsix
# or for Antigravity:
antigravity --install-extension goal-swarm-*.vsix
```

Restart VS Code / Antigravity. You should see a **Swarm** button in the bottom-left status bar.

### From the Marketplace (when published)

The extension is targeted at the VS Code Marketplace under publisher `adamsilvaconsulting`. Until that's live, use the development install path above.

## Configuration

Settings (Cmd+, → search "goal-swarm"):

- `goalSwarm.scriptPath` — Absolute path to `scripts/goal-swarm.js`. Auto-resolves relative to the extension by default.
- `goalSwarm.useTerminal` — When `true` (default), commands run in an integrated terminal so you see live output. When `false`, commands run silently and the side panel renders the captured output.

## How the status-bar button works

Click the status-bar **Swarm** item, type your objective, press Enter. The extension spawns `node scripts/goal-swarm.js plan "<objective>"` in a new terminal. That CLI runs the Stage 0 planning council, prints recommendations from every installed harness CLI (Claude / Codex / Gemini / Ollama), and exits without writing any files.

Review the council output. If you want to proceed, run `goal-swarm: Status of a swarm` or use the terminal directly to continue with Stage 1.

## How the side panel works

`goal-swarm: Open side panel` reveals a webview pane next to the editor. The panel renders the most recent council output as syntax-highlighted text with status badges (idle / running / done / error). The webview is intentionally minimal in v0.1 — the v0.2 roadmap includes:

- Click-to-approve buttons that auto-advance to Stage 1
- Per-recommendation diff comparison across council members
- Live event-log tail in the panel (no second terminal needed)
- Real-time iteration counter for the Ralph Wiggum kill switch

Contribute these via PR — see the project [CONTRIBUTING.md](../CONTRIBUTING.md). Growth-credit applies for IDE work.

## Troubleshooting

- **No status-bar button** — Check Cmd+Shift+P → "goal-swarm: Open side panel". If the command is missing, the extension didn't load; check the Extension Host log.
- **"bundled CLI not found"** — Set `goalSwarm.scriptPath` in settings to the absolute path of your `scripts/goal-swarm.js`.
- **Status-bar button is grey** — That's normal; it's a passive item. Click it.

## License

MIT. Same as the parent project.
