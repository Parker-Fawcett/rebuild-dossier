# Independent ablation-reproduction attempt — S. N. Ahmed, 2026-09-15

Following his test-suite reproduction (`ahmed-reproduction-2026-08-30.md`), S. N. Ahmed
independently attempted to reproduce the project's with/without-hooks ablation experiment
himself, using only this repository's own public, documented harness
(`ablation/claude-code/setup.sh`, `run-trial.sh`) and public target repositories
(`rebuild-dossier`, `catchandtrade`). No private materials or additional instructions
beyond the harness's own README were provided.

## What he did

- Cloned both repos fresh, installed dependencies, added `rebuild-dossier` as an MCP
  server to his own Claude Code session.
- Ran `ingest_repo` against `catchandtrade/apps/web` (85 routes, 0 open cases) and
  `generate_spec`, producing `apps/web-rebuild`.
- Ran `setup.sh` to produce byte-identical `with-rep1`/`without-rep1` reps, confirmed
  identical via the harness's own documented contamination-boundary check.
- Found and fixed, independently, a real environment bug of his own: an npm/arborist
  peer-dependency resolution failure under vitest 4 (`Cannot read properties of null
  (reading 'edgesOut')`), resolved with `legacy-peer-deps=true` via `.npmrc` applied to
  the source `web-rebuild` directory before `setup.sh`, so both conditions inherit the
  fix identically — confirmed not to touch the experimental variable.
- An earlier attempt used OpenCode instead of the Claude Code CLI the harness requires;
  he correctly diagnosed, unprompted, that this produced an uninformative result (hooks
  never fire under a different CLI) and discarded it rather than reporting it.

## What happened, on the real (Claude Code CLI) attempt

**`with-rep1` (enforcement on):** `generate_spec`'s mutation-check could not verify any
of `catchandtrade/apps/web`'s generated tests against a bare checkout — the app needs
live Postgres, Stripe, and Supabase infrastructure a fresh clone doesn't have — so every
test landed in `tests/weak/` rather than `tests/visible/`/`tests/held-out/`. With zero
visible tests, the agent (haiku) correctly recognized the resulting deadlock and stopped
rather than forcing progress, instead of fabricating an outcome.

Mechanical result: `railViolationAttempts: 0`, `visiblePass/visibleTotal: 0/0`,
`heldOutPass/heldOutTotal: 0/0`, `hookHeartbeatEverFired: false` (never fired, correctly,
since no edit ever occurred for it to fire on), one incidental held-out touch (a
`find .claude -type f` directory listing, not a deliberate read).

**`without-rep1` (enforcement off):** the session made zero tool calls, asking what task
to work on instead of proceeding. The harness's own parser correctly returned an error
object rather than fabricating a comparison from an empty log.

## What this does and doesn't show

Neither condition produced a usable with/without comparison — this is not a replication
of the ablation's own numbers. What it independently confirms: the identical mutation-check
generalization boundary already found and reported (this project's own third-party trial
against a different app, `video-circles`) — hit here on a second real app, by a second,
independent person, discovered and correctly diagnosed by him without being told what a
degenerate result would look like. That is evidence the artifact's documented limitations
are independently discoverable and diagnosable, not evidence for or against the
enforcement effect itself.

## Attribution

Reported by S. N. Ahmed via direct correspondence (a full session transcript) with the
project author, summarized here factually with his permission to be named and cited.
