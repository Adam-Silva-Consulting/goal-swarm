#!/usr/bin/env node
/**
 * goal-swarm — top-level CLI for the goal-swarm protocol.
 *
 * Subcommands:
 *   goal-swarm plan "<objective>"     Stage 0 council, print synthesis (no writes)
 *   goal-swarm start <goalId>         After GO: write goal + tasks, brief on dispatch
 *   goal-swarm dispatch <task-file>   Stage 3 dispatch to the task harness
 *   goal-swarm verify <task-id>       Stage 5 dispatch verifier and read verdict
 *   goal-swarm status <goalId>        Roll up event-log + done-file state
 *   goal-swarm watch <goalId>         Live tail of the event log
 *   goal-swarm archive <goalId>       Move active goal artifacts to archive/
 *   goal-swarm doctor                 Probe roster, check git, check Node, summarize health
 *
 * The script intentionally does the LIGHT work: scaffolding, status rollup,
 * archive sweep. Heavy lifting — actual decomposition, dispatch, verification —
 * is the Coordinator harness's job (see SKILL.md). This CLI exists so users
 * who don't run Claude Code can still drive the protocol from any terminal.
 */

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');
const KNOWN_HARNESSES = new Set([
  'codex-openai',
  'codex',
  'gemini-bridge',
  'gemini-cli',
  'gemini',
  'claude',
  'claude-direct',
]);

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function parseTaskFile(taskFile) {
  const raw = fs.readFileSync(taskFile, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) throw new Error(`task file is missing YAML frontmatter: ${taskFile}`);
  const frontmatter = {};
  for (const line of match[1].split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    frontmatter[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
  }
  return {
    frontmatter,
    body: raw.slice(match[0].length),
  };
}

function renderTemplate(template, vars) {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (all, key) => (
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : all
  ));
}

function composeDispatchPrompt(taskFile) {
  const parsed = parseTaskFile(taskFile);
  const fm = parsed.frontmatter;
  const preamblePath = path.join(SKILL_DIR, 'templates', 'gossip-preamble.md');
  const preamble = fs.readFileSync(preamblePath, 'utf8');
  const rendered = renderTemplate(preamble, {
    GOAL_ID: fm.goalId || '',
    TASK_ID: fm.taskId || '',
    ROLE: fm.role || 'specialist',
    HARNESS: fm.harness || '',
    WORKTREE_PATH: fm.worktree || '(none — Coordinator did not enable worktree isolation)',
    SKILL_DIR,
  });
  return {
    frontmatter: fm,
    prompt: `${rendered}\n\n---\n\n${parsed.body}`,
  };
}

function postSwarmEvent(goalId, taskId, harness, type, text, extraArgs) {
  const args = [
    path.join(SKILL_DIR, 'scripts', 'swarm-event.js'),
    'log',
    goalId,
    taskId,
    harness,
    type,
    text,
  ];
  if (extraArgs) args.push(...extraArgs);
  return spawnSync('node', args, { stdio: 'inherit', shell: false });
}

function bridgeRequest(prompt) {
  return new Promise((resolve) => {
    const tokenPath = path.join(process.cwd(), '.planning', 'handoffs', '.bridge-token');
    const token = fs.existsSync(tokenPath) ? fs.readFileSync(tokenPath, 'utf8').trim() : '';
    const body = JSON.stringify({ prompt, timeoutMs: 600000 });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 9876,
      path: '/chat-and-wait',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', chunk => process.stdout.write(chunk));
      res.on('end', () => resolve({ status: res.statusCode >= 200 && res.statusCode < 300 ? 0 : 1 }));
    });
    req.on('error', (err) => {
      console.error(err.message);
      resolve({ status: 1 });
    });
    req.write(body);
    req.end();
  });
}

function spawnWithPrompt(command, args, prompt, opts) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...(opts.env || {}) },
    stdio: opts.wait ? ['pipe', 'inherit', 'inherit'] : ['pipe', 'ignore', 'ignore'],
    detached: !opts.wait,
    shell: false,
  });
  child.stdin.write(prompt);
  child.stdin.end();
  if (!opts.wait) {
    child.unref();
    return Promise.resolve({ status: 0, pid: child.pid });
  }
  return new Promise((resolve) => {
    child.on('error', (err) => {
      console.error(err.message);
      resolve({ status: 1, pid: child.pid });
    });
    child.on('close', status => resolve({ status: status || 0, pid: child.pid }));
  });
}

async function runOnHarness(harness, prompt, opts) {
  const wait = opts && opts.wait;
  switch (harness) {
    case 'codex-openai':
    case 'codex':
      return spawnWithPrompt('codex', [
        'exec',
        '--skip-git-repo-check',
        '-c', 'model_provider=openai',
        '-c', 'approval_policy=never',
        '-c', 'sandbox_mode=workspace-write',
        '-',
      ], prompt, { wait });
    case 'gemini-bridge':
      if (!wait) {
        return spawnWithPrompt(process.execPath, [__filename, '__run-bridge'], prompt, { wait: false });
      }
      return bridgeRequest(prompt);
    case 'gemini-cli':
    case 'gemini':
      return spawnWithPrompt('gemini', ['-p', '', '--approval-mode', 'yolo'], prompt, {
        wait,
        env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      });
    case 'claude':
    case 'claude-direct':
      return spawnWithPrompt('claude', ['-p'], prompt, { wait });
    default:
      console.error(`unknown harness: ${harness}`);
      return { status: 2 };
  }
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'unnamed';
}

function extractAcceptanceCriteria(markdown) {
  const lines = markdown.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,3})\s+(?:\d+\.\s*)?Acceptance criteria\b/i);
    if (m) {
      start = i + 1;
      level = m[1].length;
      break;
    }
  }
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    const m = lines[i].match(/^(#{2,6})\s+/);
    if (m && m[1].length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function findTaskFile(taskId) {
  const tasksRoot = path.join(process.cwd(), '.goal-swarm', 'tasks');
  if (!fs.existsSync(tasksRoot)) throw new Error(`tasks directory not found: ${tasksRoot}`);
  for (const goalId of fs.readdirSync(tasksRoot)) {
    const candidate = path.join(tasksRoot, goalId, `${taskId}.md`);
    if (fs.existsSync(candidate)) return { goalId, taskFile: candidate };
  }
  throw new Error(`task not found under .goal-swarm/tasks: ${taskId}`);
}

function readSwarmEvents(goalId) {
  const logFile = path.join(process.cwd(), '.goal-swarm', 'active', `${goalId}.events.jsonl`);
  if (!fs.existsSync(logFile)) return [];
  return fs.readFileSync(logFile, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

async function cmdPlan(args) {
  const [objective] = args;
  if (!objective) {
    console.error('usage: goal-swarm plan "<objective>" [--repo-scan path]');
    process.exit(2);
  }
  const repoScanPath = parseFlag(args, '--repo-scan');

  // If no repo-scan was provided and we're inside a git repo, generate a
  // lightweight one on the fly so the council gets repo-aware context.
  let scanPath = repoScanPath;
  if (!scanPath && fs.existsSync('.git')) {
    scanPath = path.join('.goal-swarm', 'tmp', 'repo-scan.md');
    ensureDir(path.dirname(scanPath));
    fs.writeFileSync(scanPath, generateRepoScan(), 'utf8');
    console.error(`Generated pre-flight repo scan: ${scanPath}`);
  }

  console.error('Stage 0: planning council (no writes)\n');
  const cmd = ['node', path.join(SKILL_DIR, 'scripts', 'council-fanout.js'), 'plan', objective];
  if (scanPath) cmd.push('--repo-scan', scanPath);
  // shell: false here is intentional. `node` is a real binary on Windows
  // (no .cmd shim) so spawn() can launch it directly without cmd.exe
  // re-parsing the argv. Using shell: true here was splitting multi-word
  // objectives because cmd.exe interpreted unquoted spaces as separators.
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: false });
  process.exit(r.status || 0);
}

function generateRepoScan() {
  const parts = ['# Pre-flight repo scan', `Generated: ${new Date().toISOString()}`, ''];
  // package.json / pyproject.toml / Cargo.toml / go.mod / Gemfile etc.
  const manifestFiles = ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'Gemfile', 'composer.json'];
  for (const f of manifestFiles) {
    if (fs.existsSync(f)) {
      parts.push(`## ${f}`);
      parts.push('```');
      parts.push(fs.readFileSync(f, 'utf8').slice(0, 2000));
      parts.push('```');
      parts.push('');
    }
  }
  // Top-level structure
  parts.push('## Top-level files + directories');
  try {
    const entries = fs.readdirSync('.').filter(n => !n.startsWith('.') || ['.gitignore', '.github', '.claude'].includes(n)).sort();
    parts.push('```');
    parts.push(entries.join('\n'));
    parts.push('```');
  } catch { /* skip */ }
  parts.push('');
  // Recent commits
  try {
    const r = spawnSync('git', ['log', '--oneline', '-n', '20'], { encoding: 'utf8' });
    if (r.status === 0) {
      parts.push('## Recent commits');
      parts.push('```');
      parts.push(r.stdout);
      parts.push('```');
      parts.push('');
    }
  } catch { /* skip */ }
  // README excerpt
  for (const r of ['README.md', 'README', 'readme.md']) {
    if (fs.existsSync(r)) {
      parts.push(`## ${r} (first 2000 chars)`);
      parts.push('```');
      parts.push(fs.readFileSync(r, 'utf8').slice(0, 2000));
      parts.push('```');
      parts.push('');
      break;
    }
  }
  return parts.join('\n');
}

function cmdStart(args) {
  const [goalId] = args;
  if (!goalId) {
    console.error('usage: goal-swarm start <goalId>');
    console.error('       (Or: goal-swarm start --objective "..." --slug my-thing  to scaffold a goal file now)');
    process.exit(2);
  }
  const goalsDir = path.join(process.cwd(), '.goal-swarm', 'goals');
  ensureDir(goalsDir);
  let goalFile = path.join(goalsDir, `${goalId}.md`);
  if (!fs.existsSync(goalFile) && !goalId.startsWith('g-')) {
    goalFile = path.join(goalsDir, `g-${todayDate()}-${slugify(goalId)}.md`);
  }
  if (!fs.existsSync(goalFile)) {
    // Scaffold from template
    const templatePath = path.join(SKILL_DIR, 'templates', 'goal-file.md');
    const tpl = fs.existsSync(templatePath) ? fs.readFileSync(templatePath, 'utf8') : '# {{TITLE}}\n\n## Objective\n\n## Acceptance criteria\n\n## Constraints\n\n## Out of scope\n\n## Hard iteration cap\n--max-iterations 25\n';
    fs.writeFileSync(goalFile, tpl.replace('{{TITLE}}', goalId).replace('{{GOAL_ID}}', goalId).replace('{{DATE}}', new Date().toISOString()));
    console.log(`Scaffolded goal file: ${goalFile}`);
    console.log('Edit it with your objective + acceptance criteria, then re-run `goal-swarm start ' + path.basename(goalFile, '.md') + '`.');
    return;
  }
  console.log(`Goal file exists: ${goalFile}`);
  console.log('Hand this file to your Coordinator harness (see SKILL.md for prompts).');
  console.log('  Claude Code: open /goal with the stop condition from the SKILL.md');
  console.log('  Codex CLI:   codex exec "/goal ..."');
  console.log('  Gemini CLI:  gemini --approval-mode yolo "..."');
}

async function cmdDispatch(args) {
  const [taskFile] = args;
  if (!taskFile) {
    console.error('usage: goal-swarm dispatch <task-file> [--wait]');
    process.exit(2);
  }
  const wait = hasFlag(args, '--wait');
  const { frontmatter, prompt } = composeDispatchPrompt(taskFile);
  const goalId = frontmatter.goalId;
  const taskId = frontmatter.taskId;
  const harness = frontmatter.harness;
  if (!goalId || !taskId || !harness) {
    console.error('task frontmatter must include goalId, taskId, and harness');
    process.exit(2);
  }
  if (!KNOWN_HARNESSES.has(harness)) {
    console.error(`unknown harness: ${harness}`);
    process.exit(2);
  }
  const dispatchedAt = new Date().toISOString();
  postSwarmEvent(goalId, taskId, harness, 'status', `dispatched at ${dispatchedAt}`);
  if (!wait) {
    const child = spawn(process.execPath, [__filename, '__run-harness', harness, goalId, taskId], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'ignore', 'ignore'],
      detached: true,
      shell: false,
    });
    child.stdin.write(prompt);
    child.stdin.end();
    child.unref();
    console.log(`dispatched ${taskId} (${harness}) in background, pid ${child.pid}`);
    return;
  }
  const result = await runOnHarness(harness, prompt, { wait: true });
  if (result.status === 0) {
    postSwarmEvent(goalId, taskId, harness, 'done', `dispatcher completed at ${new Date().toISOString()}`);
  } else {
    postSwarmEvent(goalId, taskId, harness, 'blocker', `dispatcher exited with status ${result.status}`);
  }
  process.exit(result.status || 0);
}

function verifierPrompt(goalId, taskId, fm, acceptanceBody) {
  const verifierHarness = fm.verifier;
  const specialistHarness = fm.harness || 'unknown';
  const taskNum = (taskId.match(/\d+/) || [taskId])[0];
  return `You are the Verifier for ${taskId} (goal ${goalId}).
The Specialist (${specialistHarness}) claims this task is done.
Your job: independently check each acceptance criterion. Run any commands the criteria reference. Post an \`approval\` event to the swarm log if every check passes, or a \`rework\` event citing specific failures.

## Acceptance criteria (verbatim from task file)
${acceptanceBody}

## How to post your verdict
On pass:  node .claude/skills/goal-swarm/scripts/swarm-event.js log ${goalId} verifier-${taskNum} ${verifierHarness} approval "<one-line summary of which checks passed>" --to ${taskId}
On fail:  node .claude/skills/goal-swarm/scripts/swarm-event.js log ${goalId} verifier-${taskNum} ${verifierHarness} rework "<which checks failed, specifically>" --to ${taskId}
`;
}

async function cmdVerify(args) {
  const [taskId] = args;
  if (!taskId) {
    console.error('usage: goal-swarm verify <task-id>');
    process.exit(2);
  }
  const found = findTaskFile(taskId);
  const parsed = parseTaskFile(found.taskFile);
  const goalId = parsed.frontmatter.goalId || found.goalId;
  const verifierHarness = parsed.frontmatter.verifier;
  if (!verifierHarness) {
    console.error(`task frontmatter must include verifier: ${found.taskFile}`);
    process.exit(2);
  }
  if (!KNOWN_HARNESSES.has(verifierHarness)) {
    console.error(`unknown harness: ${verifierHarness}`);
    process.exit(2);
  }
  const acceptanceBody = extractAcceptanceCriteria(parsed.body);
  if (!acceptanceBody) {
    console.error(`acceptance criteria section not found: ${found.taskFile}`);
    process.exit(2);
  }
  const before = new Set(readSwarmEvents(goalId).map(e => e.ts));
  const prompt = verifierPrompt(goalId, taskId, parsed.frontmatter, acceptanceBody);
  const result = await runOnHarness(verifierHarness, prompt, { wait: true });
  if (result.status !== 0) process.exit(result.status || 1);
  const verdict = readSwarmEvents(goalId)
    .filter(e => !before.has(e.ts))
    .filter(e => e.to === taskId && (e.type === 'approval' || e.type === 'rework'))
    .slice(-1)[0];
  if (!verdict) {
    console.error(`no approval or rework event posted for ${taskId}`);
    process.exit(1);
  }
  console.log(`${verdict.type}: ${verdict.text}`);
  process.exit(verdict.type === 'approval' ? 0 : 1);
}

async function cmdRunHarness(args) {
  const [harness, goalId, taskId] = args;
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) prompt += chunk;
  const result = await runOnHarness(harness, prompt, { wait: true });
  if (result.status === 0) {
    postSwarmEvent(goalId, taskId, harness, 'done', `dispatcher completed at ${new Date().toISOString()}`);
  } else {
    postSwarmEvent(goalId, taskId, harness, 'blocker', `dispatcher exited with status ${result.status}`);
  }
  process.exit(result.status || 0);
}

async function cmdRunBridge() {
  let prompt = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) prompt += chunk;
  const result = await bridgeRequest(prompt);
  process.exit(result.status || 0);
}

function rollupStatus(goalId) {
  const tasksDir = path.join(process.cwd(), '.goal-swarm', 'tasks', goalId);
  const doneDir = path.join(process.cwd(), '.goal-swarm', 'done');
  const logFile = path.join(process.cwd(), '.goal-swarm', 'active', `${goalId}.events.jsonl`);
  const tasks = fs.existsSync(tasksDir) ? fs.readdirSync(tasksDir).filter(f => f.startsWith('task-') && f.endsWith('.md')) : [];
  const done = fs.existsSync(doneDir) ? fs.readdirSync(doneDir).filter(f => f.startsWith(`${goalId}-task-`) && f.endsWith('.md')) : [];
  let events = [];
  if (fs.existsSync(logFile)) {
    events = fs.readFileSync(logFile, 'utf8').split(/\r?\n/).filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  }
  const blockers = events.filter(e => e.type === 'blocker');
  const openQuestions = events.filter(e => e.type === 'question' && !events.some(a => a.type === 'answer' && a.inReplyTo === e.ts));
  const approvals = events.filter(e => e.type === 'approval');
  const doneEvents = events.filter(e => e.type === 'done');
  return { tasks, done, events, blockers, openQuestions, approvals, doneEvents };
}

function cmdStatus(args) {
  const [goalId] = args;
  if (!goalId) {
    console.error('usage: goal-swarm status <goalId>');
    process.exit(2);
  }
  const s = rollupStatus(goalId);
  console.log(`Goal: ${goalId}`);
  console.log(`  Task files:       ${s.tasks.length}`);
  console.log(`  Done files:       ${s.done.length}`);
  console.log(`  Total events:     ${s.events.length}`);
  console.log(`  Approvals:        ${s.approvals.length}`);
  console.log(`  Done events:      ${s.doneEvents.length}`);
  console.log(`  Open blockers:    ${s.blockers.length}`);
  console.log(`  Open questions:   ${s.openQuestions.length}`);
  if (s.blockers.length) {
    console.log('\nBlockers:');
    for (const b of s.blockers) console.log(`  [${b.ts}] ${b.task}: ${b.text}`);
  }
  if (s.openQuestions.length) {
    console.log('\nOpen questions:');
    for (const q of s.openQuestions) console.log(`  [${q.ts}] ${q.task} -> ${q.to}: ${q.text}`);
  }
  const ready = s.tasks.length > 0 &&
                s.done.length >= s.tasks.length &&
                s.approvals.length >= s.tasks.length &&
                s.blockers.length === 0 &&
                s.openQuestions.length === 0;
  console.log(`\nReady to archive: ${ready ? 'YES' : 'no'}`);
}

function cmdWatch(args) {
  const [goalId] = args;
  if (!goalId) {
    console.error('usage: goal-swarm watch <goalId>');
    process.exit(2);
  }
  const r = spawnSync('node', [path.join(SKILL_DIR, 'scripts', 'swarm-event.js'), 'watch', goalId], { stdio: 'inherit' });
  process.exit(r.status || 0);
}

function cmdArchive(args) {
  const [goalId] = args;
  if (!goalId) {
    console.error('usage: goal-swarm archive <goalId>');
    process.exit(2);
  }
  const root = path.join(process.cwd(), '.goal-swarm');
  const archive = path.join(root, 'archive', goalId);
  ensureDir(archive);
  const moves = [
    [path.join(root, 'goals', `${goalId}.md`), path.join(archive, 'goal.md')],
    [path.join(root, 'tasks', goalId), path.join(archive, 'tasks')],
    [path.join(root, 'done'), path.join(archive, 'done')],
    [path.join(root, 'active', `${goalId}.events.jsonl`), path.join(archive, 'events.jsonl')],
  ];
  let moved = 0;
  for (const [src, dst] of moves) {
    if (fs.existsSync(src)) {
      fs.renameSync(src, dst);
      moved++;
      console.log(`  moved ${src} -> ${dst}`);
    }
  }
  // Tidy summary file
  fs.writeFileSync(path.join(archive, 'summary.md'),
    `# ${goalId}\n\nArchived: ${new Date().toISOString()}\n\nMoved ${moved} of ${moves.length} expected artifacts.\n`);
  console.log(`\nArchived ${goalId} (${moved} artifacts).`);
}

async function cmdDoctor() {
  const checks = [];
  // Node version
  checks.push({ name: 'node', ok: process.versions.node >= '16.0.0', detail: process.versions.node });
  // Git available
  try { const r = spawnSync('git', ['--version'], { encoding: 'utf8' }); checks.push({ name: 'git', ok: r.status === 0, detail: r.stdout.trim() }); }
  catch { checks.push({ name: 'git', ok: false, detail: 'not found' }); }
  // Inside a git repo? Warn-only; the protocol itself works without git but
  // the worktree-isolation feature in Stage 3 needs a repo.
  checks.push({ name: 'cwd is git repo', ok: true, warn: !fs.existsSync('.git'), detail: fs.existsSync('.git') ? process.cwd() : `${process.cwd()} (no .git; worktree isolation will be unavailable)` });
  // Roster detection
  const detectR = spawnSync('node', [path.join(SKILL_DIR, 'scripts', 'council-fanout.js'), 'detect'], { encoding: 'utf8' });
  checks.push({ name: 'council roster', ok: detectR.status === 0, detail: (detectR.stdout || detectR.stderr).slice(0, 400).trim() });
  console.log('goal-swarm doctor\n');
  for (const c of checks) {
    const sym = !c.ok ? '[FAIL]' : (c.warn ? '[warn]' : '[ok  ]');
    console.log(`  ${sym} ${c.name}`);
    if (c.detail) console.log(`         ${c.detail}`);
  }
  const failed = checks.filter(c => !c.ok).length;
  const warned = checks.filter(c => c.ok && c.warn).length;
  if (failed) {
    console.log(`\n${failed} check(s) failed${warned ? `, ${warned} warning(s)` : ''}.`);
    process.exit(1);
  }
  if (warned) {
    console.log(`\n${warned} warning(s). All required checks pass.`);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'plan':    return cmdPlan(rest);
    case 'start':   return cmdStart(rest);
    case 'dispatch': return cmdDispatch(rest);
    case 'verify':  return cmdVerify(rest);
    case 'status':  return cmdStatus(rest);
    case 'watch':   return cmdWatch(rest);
    case 'archive': return cmdArchive(rest);
    case 'doctor':  return cmdDoctor();
    case '__run-harness': return cmdRunHarness(rest);
    case '__run-bridge': return cmdRunBridge();
    case '-h':
    case '--help':
    case undefined:
      console.log('goal-swarm <plan|start|dispatch|verify|status|watch|archive|doctor> ...');
      console.log('  plan "<objective>"      Stage 0 council, no writes');
      console.log('  start <goalId>          Scaffold goal file from template');
      console.log('  dispatch <task-file>    Stage 3 dispatch to task harness');
      console.log('  verify <task-id>        Stage 5 dispatch verifier and read verdict');
      console.log('  status <goalId>         Roll up task / done / event state');
      console.log('  watch <goalId>          Live tail event log');
      console.log('  archive <goalId>        Move artifacts to .goal-swarm/archive/');
      console.log('  doctor                  Probe Node, git, council roster');
      console.log('');
      console.log('See SKILL.md for the full protocol.');
      return;
    default:
      console.error(`unknown subcommand: ${cmd}`);
      process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
