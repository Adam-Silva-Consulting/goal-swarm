# Contributing to goal-swarm

This project is open source AND we share the upside. **A percentage of net monthly donation revenue is distributed to active contributors**, weighted by code merged, code quality, and growth (followers and donors brought to the project through your referral link). Top long-term contributors are eligible for **salaried roles at Adam Silva Consulting**.

There are no flat bounties. We don't promise dollar amounts we can't guarantee. Your share scales with the project's actual revenue.

## How the revenue share works

### The pool

All donations from the Stripe Payment Links in `README.md` and (once approved) GitHub Sponsors flow into one pool. Net revenue = gross donations − Stripe fees − GitHub Sponsors fees − tax remittance.

### The split

- **60%** of net monthly revenue distributed to active contributors that month
- **40%** retained by Adam Silva Consulting for maintenance, hosting, security audits, and ongoing development

### Activation threshold

Monthly distribution activates when **net donation revenue for the month exceeds $500**. Below that, donations stay in the maintenance pool to cover Stripe Connect Express overhead, tax form prep, and infra. Above the threshold, payouts happen on the 10th of the following month.

### Contributor share formula

Your share of the 60% pool that month is:

```
your_share = (code_weight + growth_weight) / Σ (everyone's combined weight)

where
  code_weight   = your_accepted_PR_count × log10(your_total_lines_changed + 10) × clean_bonus
  growth_weight = your_referred_donor_dollars × 2  +  your_verified_social_mentions × 10

clean_bonus = 1.0 baseline, doubles if zero of your merged PRs that month
              were reverted or required a hotfix within 14 days
```

Plain English:

- **Merging more PRs raises your share.** Quality and consistency matter more than dump-truck single PRs.
- **Cleanly-merged code doubles your share.** PRs that ship and stay shipped are worth 2x PRs that need hotfixes.
- **Bringing in donors raises your share.** Every dollar donated through your referral link counts double in the weighting.
- **Driving social attention raises your share.** Verified YouTube videos, blog posts, X threads, Reddit submissions get growth credit.
- **No malicious code, ever.** Any PR containing a backdoor, hidden telemetry, supply-chain attack, prompt-injection trap, or anything else that violates user trust immediately disqualifies the contributor from all current and future payouts and revokes commit access. Audited by maintainers + the Verifier gate on every PR.

## Your referral link (put this in your bio everywhere)

Every contributor gets a permanent referral URL based on their GitHub handle. **No signup, no waitlist.** Append `?ref=gh:YOUR_HANDLE` to the project URL. Use this everywhere — X bio, YouTube channel description, GitHub profile README, blog footer, video end-cards, podcast show notes, Reddit signature, conference badge:

```
https://goal-swarm.adamsilvaconsulting.com/?ref=gh:YOUR_HANDLE
```

When someone clicks that link:

1. Your referral code is stored in their browser
2. If they donate via any tier on the same browser session, **the donation is credited to your account** via Stripe's `client_reference_id` field
3. You see the credit on your personal payout dashboard within 24 hours

You can also embed the credit directly into a donation link by appending `?client_reference_id=gh:YOUR_HANDLE` to any Stripe Payment Link URL:

```
https://buy.stripe.com/dRm5kvczNcLtdQe5oJdnW03?client_reference_id=gh:YOUR_HANDLE
```

Use the project URL form for general bio links (drives both growth-credit and donor-credit). Use the Stripe URL form when you want to give someone a direct donation link for a specific tier.

## Your payout dashboard

Every contributor has a live dashboard at:

```
https://goal-swarm.adamsilvaconsulting.com/c/gh:YOUR_HANDLE
```

The dashboard shows:

- **This month so far** — merged PRs, lines changed, donor referrals, donor dollars credited, social mentions verified, projected share of the 60% pool
- **Lifetime** — total merged PRs, total referred donor dollars, total payouts received
- **Next payout estimate** — your projected dollars for the current month, recomputed daily
- **Payout history** — every transfer to your Stripe Connect Express account, with Stripe transfer ID
- **Path-to-salaried tracker** — how many of the last 4 months you placed in the top-3 contributors

No login required to view your own page (or anyone else's — transparency is the point). To **claim** payouts, you connect a Stripe Connect Express account via a button on the dashboard. Stripe handles KYC and tax forms.

## Social mention credits

Submit a `growth-credit` issue with links to your tweet, video, blog, or Reddit post. Maintainers verify within 7 days. Submit within 30 days of posting.

Qualifying mentions:

- YouTube video walkthrough or review (1,000+ views within 30 days)
- X / Twitter thread (substantive, not a one-liner)
- Blog post on a real domain (not a content farm)
- Reddit submission to a relevant technical sub with positive engagement
- Conference talk that demos goal-swarm
- Podcast episode mention with a real URL

Quality matters more than volume. One good walkthrough video beats ten low-effort tweets.

## How payouts happen

1. Connect your Stripe Connect Express account via the button on your dashboard (free, you handle KYC + tax info)
2. Monthly transfer from the ASC Stripe account to your Connect account on the 10th of the following month
3. Public transparency post on the repo wiki with:
   - Gross + net donation totals
   - Total payout
   - Per-contributor share (anonymized unless you opt in publicly via your dashboard settings)
   - Number of merged PRs, donor referrals, and social mentions credited

## What counts as an "accepted PR"

- Merged into `main` (squash or merge commit, either is fine)
- Passes the Verifier gate the protocol itself enforces (tests, lint, typecheck, no new npm dependencies unless justified)
- Not solely a typo fix or trivial whitespace change (those still get credit in `THANKS.md`, just not weighted PRs)
- Reviewed and approved by at least one maintainer
- Not malicious (see the disqualification rule above)

## Path to a salaried role at Adam Silva Consulting

Top-3 contributors by combined share for **four consecutive months** become eligible for a structured interview for a paid role at ASC. We are actively hiring developers who already understand our architecture and the protocols we ship. Open-source contribution is the highest-fidelity hiring signal there is.

Not a guarantee — interviews are real interviews. But the path is real. Contributors who become full-time at ASC stay eligible for the contributor pool for the first 6 months after hire (the share moves from project payout to a one-time signing bonus credit so you don't take a pay cut for converting).

## Disputes

If something looks wrong with the math, open an issue with the `revshare-question` label. Response within 7 days. The donation totals are pulled from Stripe receipts; the PR counts are pulled from public GitHub API data; the growth events are listed in the monthly transparency post. Anyone can audit.

## PR standards

Every PR must pass the same Verifier gate the protocol itself enforces:

- [ ] **Tests pass** — `node scripts/*.js --help` smoke tests, plus any tests you added
- [ ] **No new npm dependencies** — goal-swarm is pure stdlib Node, on purpose. PRs that add `node_modules` will be rejected unless the case is overwhelming and the dependency has a clean security track record
- [ ] **No emojis in code, commits, or output** — match the existing voice
- [ ] **No malicious code** — see the disqualification rule above. Maintainers run a manual security review on every PR before merge
- [ ] **Updated docs** — README, SKILL.md, or template, as relevant
- [ ] **CHANGELOG entry** if user-visible behavior changed
- [ ] **Issue link** in PR description (we don't merge PRs without a corresponding issue)

## Local development

```bash
git clone https://github.com/Adam-Silva-Consulting/goal-swarm
cd goal-swarm

# Smoke-test the helpers
node scripts/goal-swarm.js doctor
node scripts/swarm-event.js log g-test t1 claude status "hello"
node scripts/swarm-event.js read g-test
rm -rf .goal-swarm

# IDE extension dev
cd ide-extension
npm install
# Open in VS Code or Antigravity, F5 to launch the Extension Development Host
```

## What we want

Most-wanted contributions (each likely to drive material code-weight and growth-weight):

- More robust roster detection on Linux / Mac / Windows (`scripts/council-fanout.js` `commandExists`)
- Additional Ollama model presets and tested config entries (Kimi K2, GLM-5, Qwen3-coder, DeepSeek-Coder, etc.)
- IDE extension polish (better webview rendering, dark mode, real-time event log tail in the panel)
- Failure-mode tests (simulate critic-judge deadlock, infinite handoff, runaway iteration)
- Better integration with `claude --resume` / `codex --resume` for long swarms
- Telemetry-free usage analytics (opt-in, local-only `.goal-swarm/usage.json`)
- Tutorial videos, blog posts, and integration guides (high growth-weight, low code-weight)

## What we don't want

- Replacing `/goal` with a custom evaluator (we wrap it on purpose)
- Bundling MCP servers (use the user's existing ones)
- Real-time pub/sub broker (the JSONL blackboard is the protocol; 2-second polling is intentional)
- Hard dependencies on cloud services
- Anything that requires a Claude or OpenAI API key (the whole point is $0 API cost via OAuth-routed harnesses)

## Code of Conduct

See `CODE_OF_CONDUCT.md`. We use the Contributor Covenant.

## License

By contributing you agree your work is MIT-licensed. See `LICENSE`.

## Questions

Open an issue with the `question` label. Or for sensitive matters (security, payment, harassment), email contributions@adamsilvaconsulting.com.
