---
name: Bug report
about: Something doesn't work as documented
title: '[BUG] '
labels: bug
assignees: ''
---

## What happened

Brief description of the bug.

## What should have happened

What the docs / SKILL.md / README said would happen.

## Repro

Minimum steps to reproduce. Paste exact commands.

```bash
$ goal-swarm ...
```

## Environment

- OS: (macOS 14 / Ubuntu 22 / Windows 11)
- Node version: `node --version`
- Installed harnesses: `goal-swarm doctor` output
- goal-swarm version: (git commit SHA or release tag)

## Event log excerpt (if relevant)

If the bug involves a running swarm, paste a relevant slice of the event log:

```bash
node ~/.claude/skills/goal-swarm/scripts/swarm-event.js read <goalId> --tail 30
```

## Additional context

Anything else.
