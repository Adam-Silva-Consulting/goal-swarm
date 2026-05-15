#!/usr/bin/env node
/**
 * council-fanout — Stage 0 planning council for /goal-swarm
 *
 * Fans the same structured prompt out to every installed LLM CLI in parallel,
 * captures each response, and prints them side-by-side for the orchestrator
 * to synthesize. Probes for installed harnesses on startup so the roster
 * gracefully degrades when a CLI is missing.
 *
 * Usage:
 *   node council-fanout.js plan "<objective>" [--config path] [--timeout 120]
 *   node council-fanout.js detect [--config path]
 *
 * Config (priority order):
 *   1. --config <path>
 *   2. .goal-swarm/config.json (per-repo)
 *   3. ~/.goal-swarm/config.json (user-global)
 *   4. config.example.json next to this script (bundled default)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

function loadEnvFile() {
  // Public-skill convention: env vars in ~/.goal-swarm.env or
  // <cwd>/.goal-swarm.env get loaded automatically. Format is `KEY=value`
  // per line. Solves the bashrc-not-sourced-in-non-interactive-shell
  // problem on Linux without forcing users to learn systemd environment
  // files or per-process invocation tricks.
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const candidates = [
    path.join(process.cwd(), '.goal-swarm.env'),
    home ? path.join(home, '.goal-swarm.env') : null,
  ].filter(Boolean);
  const loaded = {};
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        // Accept `export KEY=value` or `KEY=value`
        const stripped = trimmed.replace(/^export\s+/, '');
        const eq = stripped.indexOf('=');
        if (eq === -1) continue;
        const key = stripped.slice(0, eq).trim();
        let val = stripped.slice(eq + 1).trim();
        // Strip surrounding quotes if balanced
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        loaded[key] = val;
      }
    } catch { /* skip malformed */ }
  }
  return loaded;
}

function loadConfig(args) {
  const explicit = parseFlag(args, '--config');
  const candidates = [];
  if (explicit) candidates.push(explicit);
  candidates.push(path.join(process.cwd(), '.goal-swarm', 'config.json'));
  candidates.push(path.join(os.homedir(), '.goal-swarm', 'config.json'));
  candidates.push(path.join(__dirname, '..', 'config.example.json'));
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        return { config: JSON.parse(fs.readFileSync(p, 'utf8')), path: p };
      } catch (e) {
        console.error(`[warn] failed to parse ${p}: ${e.message}`);
      }
    }
  }
  throw new Error('No config found. Looked at: ' + candidates.join(', '));
}

function parseFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

async function commandExists(cmd) {
  // Probe by spawning `<cmd> --version` with a 7s timeout. Some CLIs (gemini,
  // codex) load OAuth state on every invocation and can take ~2.5s cold.
  // Anything that needs >7s for --version is broken enough we shouldn't ship.
  const head = cmd.trim().split(/\s+/)[0];
  return new Promise(resolve => {
    const child = spawn(head, ['--version'], {
      stdio: 'ignore', shell: process.platform === 'win32',
    });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 7000);
    child.on('exit', code => { clearTimeout(timer); resolve(code === 0); });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

async function detectRoster(roster) {
  const results = await Promise.all(roster.map(async m => {
    if (m.bridge) {
      // asc-bridge route: routes through Antigravity's IDE Gemini panel.
      // Uses Antigravity OAuth (no separate API key needed). Probe with a
      // HEAD on the /health endpoint. If unreachable AND member declares a
      // fallback_cmd (e.g. standalone `gemini -p`), try that. Public-skill
      // users without Antigravity get the CLI path for free.
      if (await bridgeReachable(m.bridge)) {
        return { ...m, available: true };
      }
      if (m.fallback_cmd && await commandExists(m.fallback_cmd)) {
        return { ...m, available: true, cmd: m.fallback_cmd, bridge: undefined, _usingFallback: true };
      }
      return { ...m, available: false };
    }
    if (m.endpoint) {
      // Ollama-style; probe with a HEAD-ish request
      return { ...m, available: await endpointReachable(m.endpoint) };
    }
    if (m.cmd) {
      return { ...m, available: await commandExists(m.cmd) };
    }
    return { ...m, available: false };
  }));
  return results;
}

async function bridgeReachable(url) {
  // Bridge /health requires the bearer token. Read it from the standard
  // location; if missing or unreachable, treat the bridge as unavailable.
  let token = '';
  try {
    token = fs.readFileSync(path.join(process.cwd(), '.planning', 'handoffs', '.bridge-token'), 'utf8').trim();
  } catch { return false; }
  return new Promise(resolve => {
    try {
      const u = new URL(url);
      const health = new URL('/health', u.origin);
      const transport = health.protocol === 'https:' ? require('node:https') : require('node:http');
      const req = transport.request({
        hostname: health.hostname,
        port: health.port || (health.protocol === 'https:' ? 443 : 80),
        path: health.pathname,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        timeout: 2000,
      }, res => resolve(res.statusCode === 200));
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}

function endpointReachable(url) {
  return new Promise(resolve => {
    try {
      const { hostname, port, protocol } = new URL(url);
      const transport = protocol === 'https:' ? require('node:https') : require('node:http');
      const req = transport.request({ hostname, port: port || (protocol === 'https:' ? 443 : 80), path: '/', method: 'HEAD', timeout: 2000 }, res => {
        resolve(res.statusCode !== undefined);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    } catch { resolve(false); }
  });
}

async function callCli(member, prompt, timeoutSec) {
  return new Promise((resolve) => {
    const parts = member.cmd.trim().split(/\s+/);
    const head = parts[0];
    let rest = parts.slice(1);
    // Per-CLI invocation quirks. We pipe the prompt via stdin to avoid the
    // Windows cmd.exe ~8KB command-line limit and shell-quoting issues.
    //   - claude -p     reads stdin natively when no positional prompt supplied
    //   - gemini -p     REQUIRES a value after -p. We append an empty string;
    //                   gemini documents that the prompt is appended to stdin
    //                   (if any), so empty -p + stdin = the prompt is just stdin
    //   - codex exec    accepts a positional prompt arg only; stdin is not
    //                   reliably supported as of codex-cli 0.130-alpha. We
    //                   fall back to passing the prompt as a positional arg,
    //                   which on Windows is limited to ~8KB total command line
    if (head === 'gemini' && rest[rest.length - 1] === '-p') {
      // Empty-string arg. On Windows shell:true mode, cmd.exe strips bare
      // empties; we have to pass '""' so cmd.exe parses it back to "".
      const emptyArg = process.platform === 'win32' ? '""' : '';
      rest = [...rest, emptyArg];
    }
    // Codex needs the `-` positional to read prompt from stdin (avoids the
    // Windows 8KB cmd.exe arg limit) AND `-c model_provider=openai` to use
    // ChatGPT Pro/Plus auth instead of the default cliproxy provider. Both
    // are encoded in the default config; this is a defensive safety check.
    if (head === 'codex' && !rest.includes('-')) {
      rest = [...rest, '-'];
    }
    // Per-CLI env. Layer order: process.env (current shell) → .goal-swarm.env
    // (per-repo or user-home, solves bashrc-not-sourced-in-non-interactive issues)
    // → member.env (per-config overrides). Last-write wins.
    //
    // Gemini CLI defaults to API-key mode (GEMINI_API_KEY) but also supports
    // Antigravity / Google OAuth via GOOGLE_GENAI_USE_GCA=true. OAuth is
    // preferred (no separate quota). Users can override by setting `env` in
    // their config member entry.
    const childEnv = { ...process.env, ...loadEnvFile(), ...(member.env || {}) };
    if (head === 'gemini' && !childEnv.GEMINI_API_KEY && !childEnv.GOOGLE_GENAI_USE_GCA) {
      childEnv.GOOGLE_GENAI_USE_GCA = 'true';
    }
    if (head === 'gemini' && !childEnv.GEMINI_CLI_TRUST_WORKSPACE) {
      // Skip the interactive "Do you trust this folder?" prompt that breaks
      // headless invocations. Council fanout only reads + responds; it
      // doesn't execute repo tools. Safe to trust.
      childEnv.GEMINI_CLI_TRUST_WORKSPACE = 'true';
    }
    const child = spawn(head, rest, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: childEnv,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', d => { stderr += d.toString(); });
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: 'timeout', stdout, stderr }); }, timeoutSec * 1000);
    child.on('exit', code => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
    child.on('error', err => {
      clearTimeout(timer);
      resolve({ ok: false, error: err.message, stdout, stderr });
    });
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, error: 'stdin write failed: ' + e.message, stdout, stderr });
    }
  });
}

async function callBridge(member, prompt, timeoutSec) {
  // Routes through the asc-bridge `/chat-and-wait` endpoint, which injects
  // the prompt into Antigravity's IDE Gemini panel via
  // `antigravity.sendPromptToAgentPanel`, watches for a done report file at
  // `.planning/handoffs/for-claude/done-<taskId>.md`, and returns its body.
  // No separate API key needed; uses Antigravity OAuth.
  const tokenPath = path.join(process.cwd(), '.planning', 'handoffs', '.bridge-token');
  let token = '';
  try { token = fs.readFileSync(tokenPath, 'utf8').trim(); }
  catch { return { ok: false, error: `bridge token missing at ${tokenPath}`, stdout: '', stderr: '' }; }

  const baseUrl = member.bridge.replace(/\/chat-and-wait\/?$/, '');
  const u = new URL('/chat-and-wait', baseUrl);
  const body = JSON.stringify({ prompt, timeoutMs: timeoutSec * 1000 });
  return new Promise(resolve => {
    try {
      const transport = u.protocol === 'https:' ? require('node:https') : require('node:http');
      const req = transport.request({
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${token}`,
        },
        timeout: (timeoutSec + 30) * 1000,
      }, res => {
        let chunks = '';
        res.on('data', d => { chunks += d; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(chunks);
            // Bridge response shape (from /chat-and-wait): { taskId, reportPath, report }
            // on success, or { error, reason } on failure. Presence of `report`
            // (non-empty) is the success signal.
            if (parsed.report && parsed.report.trim()) {
              resolve({ ok: true, stdout: parsed.report, stderr: '' });
            } else {
              resolve({ ok: false, error: parsed.reason || parsed.error || 'bridge returned no report body', stdout: '', stderr: chunks.slice(0, 500) });
            }
          } catch (e) {
            resolve({ ok: false, error: `bridge response parse failed: ${e.message}`, stdout: chunks.slice(0, 500), stderr: '' });
          }
        });
      });
      req.on('error', err => resolve({ ok: false, error: `bridge request error: ${err.message}`, stdout: '', stderr: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'bridge timeout', stdout: '', stderr: '' }); });
      req.write(body);
      req.end();
    } catch (e) {
      resolve({ ok: false, error: `bridge call setup failed: ${e.message}`, stdout: '', stderr: '' });
    }
  });
}

async function callOllama(member, prompt, timeoutSec) {
  const url = member.endpoint;
  const body = JSON.stringify({
    model: member.model,
    messages: [{ role: 'user', content: prompt }],
    stream: false,
  });
  return new Promise(resolve => {
    try {
      const { hostname, port, protocol } = new URL(url);
      const transport = protocol === 'https:' ? require('node:https') : require('node:http');
      const req = transport.request({
        hostname, port: port || (protocol === 'https:' ? 443 : 80),
        path: new URL(url).pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutSec * 1000,
      }, res => {
        let chunks = '';
        res.on('data', d => { chunks += d; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(chunks);
            resolve({ ok: true, stdout: parsed?.message?.content || chunks, stderr: '' });
          } catch {
            resolve({ ok: true, stdout: chunks, stderr: '' });
          }
        });
      });
      req.on('error', err => resolve({ ok: false, error: err.message, stdout: '', stderr: '' }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout', stdout: '', stderr: '' }); });
      req.write(body);
      req.end();
    } catch (e) { resolve({ ok: false, error: e.message, stdout: '', stderr: '' }); }
  });
}

function buildCouncilPrompt(objective, repoScan) {
  const templatePath = path.join(__dirname, '..', 'templates', 'council-prompt.md');
  let template;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch {
    template = '## Objective\n\n{{OBJECTIVE}}\n\n## Repo scan\n\n{{REPO_SCAN}}\n\nRespond per the goal-swarm council template.\n';
  }
  return template.replace('{{OBJECTIVE}}', objective).replace('{{REPO_SCAN}}', repoScan || '(no repo scan provided)');
}

async function cmdDetect(args) {
  const { config, path: cfgPath } = loadConfig(args);
  console.log(`Using config: ${cfgPath}`);
  const detected = await detectRoster(config.roster);
  console.log('\nRoster:');
  for (const m of detected) {
    const status = m.available ? 'AVAILABLE' : 'missing';
    const target = m.bridge || m.endpoint || m.cmd || '(none)';
    console.log(`  [${status}] ${m.name}  ${target}`);
  }
  const ok = detected.filter(m => m.available).length;
  console.log(`\n${ok} of ${detected.length} members available.`);
  if (ok === 0) process.exit(1);
}

async function cmdPlan(args) {
  const [objective, ...rest] = args;
  if (!objective) {
    console.error('usage: council-fanout plan "<objective>" [--config path] [--timeout 120] [--repo-scan path]');
    process.exit(2);
  }
  const { config, path: cfgPath } = loadConfig(rest);
  // Timeout priority: --timeout flag > config.council_timeout_sec > 120s default
  const timeoutSec = parseInt(
    parseFlag(rest, '--timeout') ||
    (config.council_timeout_sec ? String(config.council_timeout_sec) : '120'),
    10,
  );
  const repoScanPath = parseFlag(rest, '--repo-scan');
  const repoScan = repoScanPath && fs.existsSync(repoScanPath) ? fs.readFileSync(repoScanPath, 'utf8') : '';

  console.error(`Using config: ${cfgPath}`);
  const detected = await detectRoster(config.roster);
  const available = detected.filter(m => m.available);
  if (available.length === 0) {
    console.error('No council members available. Run `council-fanout detect` to see roster status.');
    process.exit(1);
  }
  console.error(`Council members available: ${available.map(m => m.name).join(', ')}`);

  const prompt = buildCouncilPrompt(objective, repoScan);

  console.error(`\nFanning out (timeout ${timeoutSec}s per member)...`);
  const startedAt = Date.now();
  const results = await Promise.all(available.map(async m => {
    const t0 = Date.now();
    const res = m.bridge ? await callBridge(m, prompt, timeoutSec)
              : m.endpoint ? await callOllama(m, prompt, timeoutSec)
              : await callCli(m, prompt, timeoutSec);
    const elapsedMs = Date.now() - t0;
    return { member: m, res, elapsedMs };
  }));
  const totalMs = Date.now() - startedAt;

  // Emit a structured report. Caller (goal-swarm.js or the Claude session)
  // synthesizes; this script's job is to capture, not to opine.
  const report = {
    objective,
    config: cfgPath,
    timeoutSec,
    totalMs,
    members: results.map(({ member, res, elapsedMs }) => ({
      name: member.name,
      target: member.endpoint || member.cmd,
      elapsedMs,
      ok: res.ok,
      error: res.error,
      response: res.stdout,
      stderr: res.stderr ? res.stderr.slice(0, 500) : '',
    })),
  };
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'plan':   return cmdPlan(rest);
    case 'detect': return cmdDetect(rest);
    default:
      console.error(
        'usage: council-fanout <plan|detect> ...\n' +
        '  council-fanout plan "<objective>" [--config path] [--timeout 120] [--repo-scan path]\n' +
        '  council-fanout detect [--config path]'
      );
      process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
