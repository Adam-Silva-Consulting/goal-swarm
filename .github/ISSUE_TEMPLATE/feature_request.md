---
name: Feature request
about: Suggest an addition or change to the protocol
title: '[FEATURE] '
labels: enhancement
assignees: ''
---

## What's the user-visible problem

What is the contributor or end-user trying to do that's hard today?

## Proposed change

How would the protocol / CLI / IDE extension change?

## Alternatives considered

Why not do X instead? What's wrong with the current behavior?

## Does this stay inside the harness boundary?

`goal-swarm` is committed to $0 API cost via OAuth-routed harnesses. Features that require a direct API key (Anthropic, OpenAI, etc.) are rejected by default. If your proposal needs an API key, justify why.

## Does this avoid the named failure modes?

Mark which apply. Features that increase the risk of any of these will get hard scrutiny.

- [ ] Critic-Judge Deadlock (same agent suggests + gates)
- [ ] Infinite handoff loops (complex dependency graphs)
- [ ] Token leak runaway (raises the necessary max-iterations cap)
- [ ] Self-certification (Specialist marks own diff done without independent verification)
- [ ] Context-window inflation
