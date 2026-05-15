#!/usr/bin/env node
/**
 * goal-swarm — top-level CLI for the goal-swarm protocol.
 *
 * Subcommands:
 *   goal-swarm plan "<objective>"     Stage 0 council, print synthesis (no writes)
 *   goal-swarm start <goalId>         After GO: write goal + tasks, brief on dispatch
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
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SKILL_DIR = path.resolve(__dirname, '..');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function parseFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'unnamed';
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
    case 'status':  return cmdStatus(rest);
    case 'watch':   return cmdWatch(rest);
    case 'archive': return cmdArchive(rest);
    case 'doctor':  return cmdDoctor();
    case '-h':
    case '--help':
    case undefined:
      console.log('goal-swarm <plan|start|status|watch|archive|doctor> ...');
      console.log('  plan "<objective>"      Stage 0 council, no writes');
      console.log('  start <goalId>          Scaffold goal file from template');
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
