# How rebuild-dossier compares

There is no direct equivalent to this tool, so these comparisons are against adjacent
approaches people reach for when they want an AI agent to work with an existing codebase.

## vs. just prompting the agent to "understand" the codebase

The default approach: point Claude Code / Cursor at a repo and ask it to make changes.

| | Ad-hoc prompting | rebuild-dossier |
|---|---|---|
| Interface contracts | Agent guesses from context windows | Locked in CLAUDE.md before any test runs |
| Ambiguity handling | Resolved silently (code matching behavior looks intentional) | Auto-resolution requires signal agreement AND evidence someone decided; otherwise becomes a question |
| Test suite | Generated ad hoc per task | Mutation-tested suite shipped with the spec |
| Repeatability | Different run, different understanding | Same locked spec every time |

The research motivation: prior work (AgentModernize, arXiv:2605.17535) measured 0%
behavioral equivalence for rebuild pipelines without a verified feedback loop. The bet here
is that locking contracts before testing, plus one-test-at-a-time retries, does better.

## vs. writing a CLAUDE.md by hand

Hand-written CLAUDE.md files describe intent. They go stale the first time someone ships
without updating them. A dossier is generated from the actual code and observed behavior,
and it ships with tests that fail if behavior drifts from the documented contract.

## vs. snapshot/freeze tools

Freeze tools capture state but give an agent no way to verify its work against that state.
A dossier pairs the spec with a mutation-tested suite, so the agent gets a feedback loop,
not just documentation.

## What this tool deliberately does not do

- It does not rebuild your app. It produces the spec a coding agent consumes to do that.
- It does not claim behavioral equivalence. v0 findings, including what broke, are in
  docs/v0-findings.md.
- It does not auto-resolve ambiguity without affirmative decision evidence. That rule is
  non-negotiable by design.
