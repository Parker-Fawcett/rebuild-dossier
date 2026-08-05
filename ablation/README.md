# Contract-locking ablation (run via OpenCode)

Tests whether *mechanical* enforcement of contract-locking (not just writing
the rule down in CLAUDE.md) actually changes outcomes — the core bet in
[README.md](../README.md#why). One isolated variable: whether
`.opencode/plugin/contract-locking.ts` is present. Everything else (spec,
contracts, tests, kickoff prompt) is byte-identical across every rep.

## Why a native plugin, not `.claude/settings.json`

OpenCode does not natively enforce Claude Code's PreToolUse/PostToolUse hooks
— it has its own plugin API (`tool.execute.before`/`after`). Without
[`contract-locking.ts`](contract-locking.ts), generate_spec's own hooks
silently do nothing under OpenCode, and "with" vs "without" would look
identical. **Smoke-tested live** against a real OpenCode session
(opencode-ai@1.18.13, the free `opencode/deepseek-v4-flash-free` model) — see
that file's own header for the three cases confirmed (spec/ edit blocked,
untested-contract write blocked, ordinary write unaffected).

## Steps

1. Run `ingest_repo` + resolve the case queue + `generate_spec` against your
   target app **once**, normally, exactly as the main README describes.
2. `./setup.sh "/path/to/app-rebuild" 3` — prepares 3 "with" reps and 3
   "without" reps under a sibling `ablation-<app-rebuild>/` directory, all
   copied from the same generate_spec output.
3. For each of the 6 rep directories: `cd` into it, `npm install`, start a
   **fresh** OpenCode session with nothing else in scope, and paste in
   [`trial-prompt.txt`](trial-prompt.txt).
4. Record each rep's final report (the 6 numbered metrics) somewhere durable
   — a spreadsheet or a plain text file, one row per rep.

## Reporting variance, not a single paired run

For each condition (with / without), across its 3 reps, report the range —
not just a mean — for at minimum: visible pass rate, held-out pass rate, rail
violation attempts, and batch-build incidents. A single paired run (1 with, 1
without) proves nothing about variance; that's the whole reason this is 3
reps per condition, not 1.

Worth stating plainly once you have the numbers: if the "without" condition's
own reps disagree with each other about how often the model batch-builds or
strays into `spec/`, that's a real finding in itself (the failure mode is
inconsistent, not just present-or-absent) — don't average it away.
