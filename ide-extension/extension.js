// goal-swarm VS Code / Antigravity extension.
//
// Adds an Activity Bar icon (left rail) that opens a webview "Swarm" panel,
// a status-bar Swarm button, six commands in the palette, and a side-panel
// view that lists local swarm state. Runs the bundled goal-swarm.js CLI;
// no API keys required.

const vscode = require('vscode');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

function resolveScriptPath(context) {
  const configured = vscode.workspace.getConfiguration('goalSwarm').get('scriptPath');
  if (configured && fs.existsSync(configured)) return configured;
  // Resolution order:
  //   1. extension/../scripts/  (dev install: extension is sibling of scripts/)
  //   2. extension/scripts/     (vsix-bundled install: scripts shipped inside)
  //   3. <workspace>/.claude/skills/goal-swarm/scripts/  (user has the skill in their repo)
  //   4. ~/.claude/skills/goal-swarm/scripts/            (user has the skill globally)
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = [
    path.join(context.extensionPath, '..', 'scripts', 'goal-swarm.js'),
    path.join(context.extensionPath, 'scripts', 'goal-swarm.js'),
    ws ? path.join(ws, '.claude', 'skills', 'goal-swarm', 'scripts', 'goal-swarm.js') : null,
    path.join(home, '.claude', 'skills', 'goal-swarm', 'scripts', 'goal-swarm.js'),
  ].filter(Boolean);
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Shared OutputChannel — survives across multiple Plan/Status/Watch calls
// so users can scroll back through earlier swarm runs in one place.
let _outputChannel = null;
function getOutputChannel() {
  if (!_outputChannel) _outputChannel = vscode.window.createOutputChannel('goal-swarm');
  return _outputChannel;
}

function runWithOutput(scriptPath, subcommand, args, opts) {
  // Stream stdout/stderr to the goal-swarm OutputChannel. This bypasses
  // terminal quoting issues entirely (PowerShell vs cmd vs bash all handle
  // escape rules differently; spawning directly removes the shell from the
  // loop). Returns a Promise that resolves with the exit code.
  const channel = getOutputChannel();
  channel.show(true);
  const ts = new Date().toISOString();
  channel.appendLine('');
  channel.appendLine(`──── ${ts} ──── ${subcommand} ────`);
  channel.appendLine(`$ node ${scriptPath} ${subcommand} ${args.map(a => JSON.stringify(a)).join(' ')}`);
  channel.appendLine('');
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
  return new Promise((resolve) => {
    const child = spawn('node', [scriptPath, subcommand, ...args], {
      cwd: ws,
      shell: false,
      env: { ...process.env, ...(opts?.env || {}) },
    });
    child.stdout.on('data', d => channel.append(d.toString()));
    child.stderr.on('data', d => channel.append(d.toString()));
    child.on('error', err => {
      channel.appendLine(`\n[error] ${err.message}`);
      resolve({ code: -1, error: err.message });
    });
    child.on('exit', code => {
      channel.appendLine(`\n──── exit ${code} ────`);
      resolve({ code: code || 0 });
    });
  });
}

function runInTerminal(scriptPath, subcommand, args) {
  // Legacy terminal path, kept for `watch` (which is genuinely interactive
  // and benefits from tail-style live output in a terminal). Other commands
  // route through runWithOutput now.
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const terminal = vscode.window.createTerminal({
    name: `goal-swarm: ${subcommand}`,
    cwd: ws,
  });
  terminal.show();
  const quotedArgs = args.map(a => `"${String(a).replace(/"/g, '\\"')}"`).join(' ');
  terminal.sendText(`node "${scriptPath}" ${subcommand} ${quotedArgs}`);
}

function runCaptureStdout(scriptPath, subcommand, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [scriptPath, subcommand, ...args], {
      cwd: cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
      shell: false,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    child.on('exit', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`exit ${code}: ${stderr}`));
    });
    child.on('error', reject);
  });
}

// ─── Activity Bar webview view ──────────────────────────────────────

class GoalSwarmHomeProvider {
  constructor(context) {
    this.context = context;
    this.view = null;
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = { enableScripts: true };
    // Initial render with "detecting..." placeholder, then async-detect roster
    view.webview.html = this.render(null);
    this.detectHarnessesAsync().then(harnesses => {
      if (this.view) this.view.webview.html = this.render(harnesses);
    });
    view.webview.onDidReceiveMessage(msg => {
      if (msg.cmd === 'plan')    vscode.commands.executeCommand('goalSwarm.plan');
      if (msg.cmd === 'doctor')  vscode.commands.executeCommand('goalSwarm.doctor');
      if (msg.cmd === 'status')  vscode.commands.executeCommand('goalSwarm.status');
      if (msg.cmd === 'watch')   vscode.commands.executeCommand('goalSwarm.watch');
      if (msg.cmd === 'archive') vscode.commands.executeCommand('goalSwarm.archive');
      if (msg.cmd === 'refresh') {
        view.webview.html = this.render(null);
        this.detectHarnessesAsync().then(h => {
          if (this.view) this.view.webview.html = this.render(h);
        });
      }
    });
  }

  detectHarnessesAsync() {
    // Run council-fanout detect to get the roster status. Returns array of
    // { name, target, available } or null on failure. Times out after 12s
    // to avoid hanging the panel on a stuck CLI probe.
    return new Promise(resolve => {
      const scriptPath = resolveScriptPath(this.context);
      if (!scriptPath) return resolve(null);
      const fanoutPath = path.join(path.dirname(scriptPath), 'council-fanout.js');
      if (!fs.existsSync(fanoutPath)) return resolve(null);
      const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd();
      const child = spawn('node', [fanoutPath, 'detect'], { cwd: ws, shell: false });
      let stdout = '';
      const timer = setTimeout(() => { child.kill(); resolve(null); }, 12000);
      child.stdout.on('data', d => { stdout += d.toString(); });
      child.on('exit', () => {
        clearTimeout(timer);
        // Parse the detect output:
        //   [AVAILABLE] claude  claude -p
        //   [missing] codex  codex exec ...
        //   [AVAILABLE] gemini  http://127.0.0.1:9876/chat-and-wait
        const harnesses = [];
        for (const line of stdout.split(/\r?\n/)) {
          const m = line.match(/\[(AVAILABLE|missing)\]\s+(\S+)\s+(.+)$/);
          if (m) harnesses.push({ available: m[1] === 'AVAILABLE', name: m[2], target: m[3].trim() });
        }
        resolve(harnesses);
      });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
    });
  }

  render(harnesses) {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activeGoals = this.listActiveGoals(ws);
    let harnessSection;
    if (harnesses === null || harnesses === undefined) {
      harnessSection = '<div class="empty">Detecting installed harnesses...</div>';
    } else if (harnesses.length === 0) {
      harnessSection = '<div class="empty">No harnesses found. Install claude / codex / gemini CLIs.</div>';
    } else {
      const okCount = harnesses.filter(h => h.available).length;
      harnessSection = `<div class="harness-summary">${okCount} of ${harnesses.length} available</div>` +
        harnesses.map(h => `
          <div class="harness-item ${h.available ? 'ok' : 'missing'}">
            <span class="harness-dot"></span>
            <span class="harness-name">${escapeHtml(h.name)}</span>
            <span class="harness-target">${escapeHtml(h.target)}</span>
          </div>
        `).join('');
    }
    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><style>
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    padding: 12px;
    line-height: 1.4;
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    margin: 0;
  }
  h2 { font-size: 13px; margin: 0 0 4px; font-weight: 600; }
  .tagline { font-size: 11px; opacity: 0.7; margin: 0 0 14px; }
  .hero {
    display: flex; flex-direction: column; gap: 6px;
    padding: 10px; margin-bottom: 14px;
    background: var(--vscode-textBlockQuote-background);
    border-radius: 4px;
    border-left: 3px solid var(--vscode-textLink-foreground);
  }
  .hero-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.7; }
  .hero-num { font-size: 18px; font-weight: 600; }
  .hero-sub { font-size: 11px; opacity: 0.7; }
  button {
    width: 100%;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: 1px solid var(--vscode-button-border, transparent);
    padding: 8px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    text-align: left;
    margin-bottom: 6px;
    display: flex; align-items: center; gap: 8px;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: transparent; border-color: var(--vscode-panel-border); color: var(--vscode-foreground); }
  button.secondary:hover { background: var(--vscode-list-hoverBackground); }
  .icon { font-size: 14px; }
  .section { margin: 16px 0 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; opacity: 0.7; }
  .goal-list { display: flex; flex-direction: column; gap: 4px; }
  .goal-item {
    padding: 6px 8px; border-radius: 3px; cursor: pointer; font-size: 11px;
    background: var(--vscode-list-inactiveSelectionBackground);
  }
  .goal-item:hover { background: var(--vscode-list-hoverBackground); }
  .empty { font-size: 11px; opacity: 0.5; font-style: italic; padding: 4px 0; }
  .harness-summary { font-size: 10px; opacity: 0.7; margin-bottom: 6px; }
  .harness-item {
    display: flex; align-items: center; gap: 6px;
    padding: 4px 8px; margin-bottom: 2px; border-radius: 3px; font-size: 11px;
    background: var(--vscode-list-inactiveSelectionBackground);
  }
  .harness-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .harness-item.ok .harness-dot { background: #10b981; }
  .harness-item.missing .harness-dot { background: #6b7280; opacity: 0.5; }
  .harness-item.missing { opacity: 0.5; }
  .harness-name { font-weight: 600; min-width: 60px; }
  .harness-target { font-size: 10px; opacity: 0.7; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px solid var(--vscode-panel-border); font-size: 10px; opacity: 0.6; line-height: 1.5; }
  .footer a { color: var(--vscode-textLink-foreground); text-decoration: none; }
  .footer a:hover { text-decoration: underline; }
</style></head>
<body>
  <h2>goal-swarm</h2>
  <div class="tagline">Multi-agent AI orchestration</div>

  <div class="hero">
    <span class="hero-label">API cost per session</span>
    <span class="hero-num">$0.00</span>
    <span class="hero-sub">OAuth-routed through your Claude / ChatGPT / Gemini subs</span>
  </div>

  <button onclick="post('plan')"><span class="icon">&#x1F680;</span><span>Plan a swarm</span></button>
  <button class="secondary" onclick="post('doctor')"><span class="icon">&#x2699;</span><span>Doctor (probe roster)</span></button>
  <button class="secondary" onclick="post('status')"><span class="icon">&#x2139;</span><span>Status of a swarm</span></button>
  <button class="secondary" onclick="post('watch')"><span class="icon">&#x1F441;</span><span>Watch event log</span></button>
  <button class="secondary" onclick="post('archive')"><span class="icon">&#x1F4E6;</span><span>Archive a swarm</span></button>

  <div class="section">Harnesses</div>
  ${harnessSection}

  <div class="section">Active goals</div>
  <div class="goal-list">
    ${activeGoals.length === 0
      ? '<div class="empty">No active swarms. Click "Plan a swarm" to start one.</div>'
      : activeGoals.map(g => `<div class="goal-item">${escapeHtml(g)}</div>`).join('')}
  </div>

  <div class="footer">
    Built by <a href="https://www.adamsilvaconsulting.com">Adam Silva Consulting</a>.<br/>
    Open source, MIT.<br/>
    60% of donations shared with contributors.<br/>
    <a href="https://github.com/Adam-Silva-Consulting/goal-swarm">Contribute</a> &middot;
    <a href="https://buy.stripe.com/dRm5kvczNcLtdQe5oJdnW03">Sponsor</a>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function post(cmd) { vscode.postMessage({ cmd }); }
  </script>
</body></html>`;
  }

  listActiveGoals(ws) {
    if (!ws) return [];
    const dir = path.join(ws, '.goal-swarm', 'active');
    if (!fs.existsSync(dir)) return [];
    try {
      return fs.readdirSync(dir)
        .filter(f => f.endsWith('.events.jsonl'))
        .map(f => f.replace('.events.jsonl', ''));
    } catch { return []; }
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Side panel (Cmd+P → Open side panel) ──────────────────────────

let panel = null;

function openPanel(context) {
  if (panel) { panel.reveal(vscode.ViewColumn.Beside); return panel; }
  panel = vscode.window.createWebviewPanel(
    'goalSwarmPanel', 'goal-swarm',
    vscode.ViewColumn.Beside,
    { enableScripts: true, retainContextWhenHidden: true }
  );
  panel.webview.html = renderPanelHtml('Open the Activity Bar icon to begin, or use the command palette.');
  panel.onDidDispose(() => { panel = null; }, null, context.subscriptions);
  return panel;
}

function renderPanelHtml(body, kind = 'idle') {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" /><style>
  body { font-family: -apple-system, sans-serif; padding: 16px; color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); }
  h1 { font-size: 18px; margin: 0 0 12px; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; margin-bottom: 12px; }
  .badge.idle { background: var(--vscode-input-background); color: var(--vscode-input-foreground); }
  .badge.running { background: #f59e0b; color: #000; }
  .badge.done { background: #10b981; color: #000; }
  .badge.error { background: #ef4444; color: #fff; }
  pre { white-space: pre-wrap; word-break: break-word; background: var(--vscode-textBlockQuote-background); padding: 12px; border-radius: 4px; font-family: ui-monospace, monospace; font-size: 12px; }
  .small { font-size: 11px; opacity: 0.7; }
</style></head>
<body>
  <h1>goal-swarm</h1>
  <div class="badge ${kind}">${kind.toUpperCase()}</div>
  <pre>${escapeHtml(body)}</pre>
  <div class="small">$0 API cost &middot; OAuth-routed &middot; Cross-model verified</div>
</body></html>`;
}

function activate(context) {
  const scriptPath = resolveScriptPath(context);
  if (!scriptPath) {
    vscode.window.showWarningMessage('goal-swarm: bundled CLI not found. Set goalSwarm.scriptPath in settings.');
  }

  // Activity Bar view (the prominent left-rail icon)
  const homeProvider = new GoalSwarmHomeProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('goalSwarmHome', homeProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Status-bar button (additional surface)
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  item.text = '$(rocket) Swarm';
  item.tooltip = 'goal-swarm: plan a multi-agent swarm';
  item.command = 'goalSwarm.plan';
  item.show();
  context.subscriptions.push(item);

  // Commands
  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.plan', async () => {
    if (!scriptPath) { vscode.window.showErrorMessage('goal-swarm: bundled CLI not found.'); return; }
    const objective = await vscode.window.showInputBox({
      placeHolder: 'What should the swarm accomplish?',
      prompt: 'goal-swarm: Plan (Stage 0 council, no writes)',
      ignoreFocusOut: true,
    });
    if (!objective) return;
    const useTerminal = vscode.workspace.getConfiguration('goalSwarm').get('useTerminal', true);
    if (useTerminal) {
      runWithOutput(scriptPath, 'plan', [objective]);
    } else {
      const p = openPanel(context);
      p.webview.html = renderPanelHtml(`Planning: ${objective}\n\nRunning Stage 0 council in plan-mode (no writes)...`, 'running');
      try {
        const { stdout } = await runCaptureStdout(scriptPath, 'plan', [objective]);
        p.webview.html = renderPanelHtml(stdout, 'done');
      } catch (e) {
        p.webview.html = renderPanelHtml(`Error: ${e.message}`, 'error');
      }
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.status', async () => {
    if (!scriptPath) { vscode.window.showErrorMessage('goal-swarm: bundled CLI not found.'); return; }
    const goalId = await vscode.window.showInputBox({ placeHolder: 'goal ID (e.g. g-2026-05-15-rate-limit)', prompt: 'goal-swarm: Status' });
    if (!goalId) return;
    runWithOutput(scriptPath, 'status', [goalId]);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.watch', async () => {
    if (!scriptPath) { vscode.window.showErrorMessage('goal-swarm: bundled CLI not found.'); return; }
    const goalId = await vscode.window.showInputBox({ placeHolder: 'goal ID', prompt: 'goal-swarm: Watch event log (Ctrl-C to stop)' });
    if (!goalId) return;
    runInTerminal(scriptPath, 'watch', [goalId]);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.archive', async () => {
    if (!scriptPath) { vscode.window.showErrorMessage('goal-swarm: bundled CLI not found.'); return; }
    const goalId = await vscode.window.showInputBox({ placeHolder: 'goal ID', prompt: 'goal-swarm: Archive' });
    if (!goalId) return;
    const yes = await vscode.window.showWarningMessage(`Archive ${goalId}?`, { modal: true }, 'Archive', 'Cancel');
    if (yes !== 'Archive') return;
    runWithOutput(scriptPath, 'archive', [goalId]);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.doctor', () => {
    if (!scriptPath) { vscode.window.showErrorMessage('goal-swarm: bundled CLI not found.'); return; }
    runWithOutput(scriptPath, 'doctor', []);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.openPanel', () => {
    openPanel(context);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('goalSwarm.refreshHome', () => {
    if (homeProvider.view) homeProvider.view.webview.html = homeProvider.render();
  }));
}

function deactivate() {}

module.exports = { activate, deactivate };
