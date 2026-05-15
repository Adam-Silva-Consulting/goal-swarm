#!/usr/bin/env node
/**
 * swarm-event — cross-harness gossip CLI for /goal-swarm
 *
 * Append-only JSONL blackboard. Any harness (Claude / Codex / Gemini / Ollama
 * / custom) writes events; all harnesses read them. Same file is polled by
 * the Coordinator's stop-condition evaluator.
 *
 *   swarm-event log    <goalId> <task> <harness> <type> "<text>" [--to taskId] [--inReplyTo ts]
 *   swarm-event read   <goalId> [--since ISO] [--task X] [--type T] [--tail N] [--json]
 *   swarm-event ask    <goalId> <fromTask> <toTask> "<question>" [--wait 300] [--harness X]
 *   swarm-event watch  <goalId> [--since ISO]
 *
 * Event types: status | finding | question | answer | blocker | approval | rework | done
 *
 * Log location (in priority order):
 *   1. $GOAL_SWARM_LOG (full path override)
 *   2. .goal-swarm/active/<goalId>.events.jsonl (per-goal, default)
 *   3. .swarm/state.jsonl (repo-wide, set via --shared flag)
 *
 * Append-only writes are safe under concurrent processes on POSIX + NTFS
 * because each JSON line is smaller than PIPE_BUF on every platform we target.
 */

const fs = require('node:fs');
const path = require('node:path');

const VALID_TYPES = new Set([
  'status', 'finding', 'question', 'answer', 'blocker', 'pause_for_human', 'approval', 'rework', 'done',
]);

function logPath(goalId, opts) {
  if (process.env.GOAL_SWARM_LOG) return process.env.GOAL_SWARM_LOG;
  if (opts && opts.shared) return path.join(process.cwd(), '.swarm', 'state.jsonl');
  return path.join(process.cwd(), '.goal-swarm', 'active', `${goalId}.events.jsonl`);
}

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readEvents(goalId, opts) {
  const p = logPath(goalId, opts);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, 'utf8');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip malformed */ }
  }
  return out;
}

function appendEvent(ev, opts) {
  const p = logPath(ev.goalId, opts);
  ensureDir(p);
  fs.appendFileSync(p, JSON.stringify(ev) + '\n', 'utf8');
}

function formatEvent(ev) {
  const arrow = ev.to ? ` -> ${ev.to}` : '';
  const reply = ev.inReplyTo ? ` (re: ${ev.inReplyTo})` : '';
  return `[${ev.ts}] ${ev.task} (${ev.harness}) ${ev.type}${arrow}${reply}: ${ev.text}`;
}

function parseFlag(args, flag) {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return undefined;
  return args[i + 1];
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function cmdLog(args) {
  const [goalId, task, harness, type, ...rest] = args;
  if (!goalId || !task || !harness || !type || rest.length === 0) {
    console.error('usage: swarm-event log <goalId> <task> <harness> <type> "<text>" [--to taskId] [--inReplyTo ts] [--shared]');
    process.exit(2);
  }
  if (!VALID_TYPES.has(type)) {
    console.error(`invalid type "${type}". must be one of: ${[...VALID_TYPES].join(' | ')}`);
    process.exit(2);
  }
  const to = parseFlag(rest, '--to');
  const inReplyTo = parseFlag(rest, '--inReplyTo');
  const shared = hasFlag(rest, '--shared');
  const textParts = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--to' || rest[i] === '--inReplyTo') { i++; continue; }
    if (rest[i] === '--shared') continue;
    textParts.push(rest[i]);
  }
  const text = textParts.join(' ');
  const ev = {
    ts: new Date().toISOString(),
    goalId,
    task,
    harness,
    type,
    text,
    ...(to ? { to } : {}),
    ...(inReplyTo ? { inReplyTo } : {}),
  };
  appendEvent(ev, { shared });
  console.log(formatEvent(ev));
}

async function cmdRead(args) {
  const [goalId, ...rest] = args;
  if (!goalId) {
    console.error('usage: swarm-event read <goalId> [--since ISO] [--task X] [--type T] [--tail N] [--json] [--shared]');
    process.exit(2);
  }
  const since = parseFlag(rest, '--since');
  const taskFilter = parseFlag(rest, '--task');
  const typeFilter = parseFlag(rest, '--type');
  const tailRaw = parseFlag(rest, '--tail');
  const tail = tailRaw ? parseInt(tailRaw, 10) : undefined;
  const asJson = hasFlag(rest, '--json');
  const shared = hasFlag(rest, '--shared');

  let events = readEvents(goalId, { shared });
  if (since) events = events.filter(e => e.ts > since);
  if (taskFilter) events = events.filter(e => e.task === taskFilter || e.to === taskFilter);
  if (typeFilter) events = events.filter(e => e.type === typeFilter);
  if (tail && tail > 0) events = events.slice(-tail);

  if (asJson) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }
  for (const ev of events) console.log(formatEvent(ev));
}

async function cmdAsk(args) {
  const [goalId, fromTask, toTask, ...rest] = args;
  if (!goalId || !fromTask || !toTask || rest.length === 0) {
    console.error('usage: swarm-event ask <goalId> <fromTask> <toTask> "<question>" [--wait seconds] [--harness X]');
    process.exit(2);
  }
  const waitRaw = parseFlag(rest, '--wait');
  const waitSec = waitRaw ? parseInt(waitRaw, 10) : 300;
  const harness = parseFlag(rest, '--harness') || 'unknown';
  const shared = hasFlag(rest, '--shared');
  const textParts = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--wait' || rest[i] === '--harness') { i++; continue; }
    if (rest[i] === '--shared') continue;
    textParts.push(rest[i]);
  }
  const text = textParts.join(' ');
  const question = {
    ts: new Date().toISOString(),
    goalId,
    task: fromTask,
    harness,
    type: 'question',
    text,
    to: toTask,
  };
  appendEvent(question, { shared });
  console.error(`asked ${toTask}: "${text}". waiting up to ${waitSec}s for answer.`);

  const deadline = Date.now() + waitSec * 1000;
  const p = logPath(goalId, { shared });
  let lastSize = fs.existsSync(p) ? fs.statSync(p).size : 0;

  while (Date.now() < deadline) {
    await sleep(2000);
    if (!fs.existsSync(p)) continue;
    const size = fs.statSync(p).size;
    if (size === lastSize) continue;
    lastSize = size;
    const events = readEvents(goalId, { shared });
    const answer = events.find(e =>
      e.type === 'answer' &&
      e.inReplyTo === question.ts &&
      e.to === fromTask &&
      e.task === toTask
    );
    if (answer) {
      console.log(answer.text);
      return;
    }
  }
  console.error(`timed out after ${waitSec}s with no answer from ${toTask}`);
  process.exit(1);
}

async function cmdWatch(args) {
  const [goalId, ...rest] = args;
  if (!goalId) {
    console.error('usage: swarm-event watch <goalId> [--since ISO] [--shared]');
    process.exit(2);
  }
  const shared = hasFlag(rest, '--shared');
  let since = parseFlag(rest, '--since') || new Date(0).toISOString();
  console.error(`watching ${logPath(goalId, { shared })} (Ctrl-C to stop)`);
  while (true) {
    const events = readEvents(goalId, { shared }).filter(e => e.ts > since);
    for (const ev of events) {
      console.log(formatEvent(ev));
      since = ev.ts;
    }
    await sleep(2000);
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'log':   return cmdLog(rest);
    case 'read':  return cmdRead(rest);
    case 'ask':   return cmdAsk(rest);
    case 'watch': return cmdWatch(rest);
    default:
      console.error(
        'usage: swarm-event <log|read|ask|watch> ...\n' +
        '  swarm-event log    <goalId> <task> <harness> <type> "<text>" [--to taskId] [--inReplyTo ts] [--shared]\n' +
        '  swarm-event read   <goalId> [--since ISO] [--task X] [--type T] [--tail N] [--json] [--shared]\n' +
        '  swarm-event ask    <goalId> <fromTask> <toTask> "<question>" [--wait seconds] [--harness X] [--shared]\n' +
        '  swarm-event watch  <goalId> [--since ISO] [--shared]'
      );
      process.exit(2);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
