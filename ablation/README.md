# Contract-locking ablation (run via OpenCode)

Tests whether *mechanical* enforcement of contract-locking (not just writing
the rule down in CLAUDE.md) actually changes outcomes — the core bet in
[README.md](../README.md#why). One isolated variable: whether a file named
`enforce` exists in a rep's own sibling `.plugin-state/<rep-name>/` directory
(see the contamination-boundary section below for why it lives there, not in
the rep). Everything inside the rep itself — spec, contracts, tests, kickoff
prompt, and the logging plugin — is byte-identical across every rep,
confirmed via `diff -rq` between paired reps.

## Why a native plugin, not `.claude/settings.json`

OpenCode does not natively enforce Claude Code's PreToolUse/PostToolUse hooks
— it has its own plugin API (`tool.execute.before`/`after`). Without
[`activity-log.ts`](activity-log.ts), generate_spec's own hooks silently do
nothing under OpenCode, and "with" vs "without" would look identical.

## The contamination boundary — confirmed live, fixed after a real leak

A dry run (not just a design review) caught a real leak: an earlier version
wrote its activity log and enforcement marker files inside the rep's own
project root. A real OpenCode session, during its normal initial
`find`/`ls` exploration, read them directly — the model could see it was
inside a controlled study, the same class of problem as leaking "ablation"
language into a file's own text, just at the directory-listing layer instead
of the string layer.

**Fixed by moving every harness-created artifact outside the rep entirely.**
`activity-log.ts` writes its log and reads its enforcement marker from a
sibling directory, `../.plugin-state/<rep-dir-name>/`, never from anywhere
inside the rep's own tree. The only thing that has to live inside a rep is
`activity-log.ts` itself, at the exact path (`.opencode/plugin/activity-log.ts`)
OpenCode's own plugin-discovery convention requires — and that file is kept
free of any study-specific language (no "ablation," "rep," "trial," or
"condition" anywhere in it, confirmed by grep, not just by author intent).

Re-verified after the fix, not assumed: `diff -rq` between a "with" and
"without" rep, freshly prepared by `setup.sh`, shows **zero difference** —
the two reps are now byte-identical, indistinguishable from inside the rep,
with the entire signal living in the sibling `.plugin-state/` directory a
session inside the rep has no path to.

## One merged plugin, not two — confirmed live, not assumed

The natural design is two plugins: one that blocks (locking), one that
observes (logging), so logging exists identically whether or not enforcement
is on. That design was tried and found broken by direct test, not by
inspection: with a pure logging plugin and a separate blocking plugin both
installed, blocking an edit under `spec/` left **zero trace in the log
file** — the logging plugin's own `tool.execute.before` hook never ran at
all for that tool call. Whichever plugin's hook runs first and throws
appears to stop any other plugin's hook for that same tool call from
running. There is no way to split logging and enforcement across two plugin
files and trust the log — so `activity-log.ts` does both: every tool call is
logged first, unconditionally, in the same hook invocation that then decides
whether to block. Re-tested after merging, both directions confirmed: an
enforced block still produces a log line for the attempt, and an unenforced
(no marker file) attempt succeeds while still being logged.

Also confirmed live, needed for the harness below: `tool.execute.after`'s
second argument exposes the real result of a completed tool call, not just
its arguments — for `read`, the full file content; for `bash`, real stdout
and the real exit code. That's what lets `parse-log.mjs` detect "the visible
suite just went fully green" by pattern-matching a logged bash call's own
output, instead of asking the agent to report it.

## Steps

1. Run `ingest_repo` + resolve the case queue + `generate_spec` against your
   target app **once**, normally, exactly as the main README describes.
2. `./setup.sh "/path/to/app-rebuild" 3` — prepares 3 "with" reps and 3
   "without" reps under a sibling `ablation-<app-rebuild>/` directory, all
   copied from the same generate_spec output. Every rep gets
   `.opencode/plugin/activity-log.ts`; only "with" reps get an `enforce`
   marker file, written to `.plugin-state/<rep-name>/`, not into the rep.
3. `./run-all.sh "/path/to/ablation-app-rebuild" <model>` — runs every rep
   headlessly (`opencode run ... --auto`), captures each rep's full
   transcript and mechanical `summary.json` into its own
   `.plugin-state/<rep-name>/` directory, and merges everything into
   `aggregate-report.json` at the ablation root.
   - **Pick the model deliberately.** `opencode/deepseek-v4-flash-free` has
     been dry-run end to end on a minimal 3-route fixture (see below) and
     completed both conditions correctly, but that's one small fixture, not
     a real app — don't treat it as validated for a real target without
     watching at least one real rep run.
   - Sequential, not parallel, by design — running 6 OpenCode sessions
     concurrently against a shared model/rate limit hasn't been tested.
   - Each trial can run for an extended period even on a tiny fixture (the
     free-tier model in particular can be slow) — budget real wall-clock
     time for 6 sequential reps against a real app.
4. Read `aggregate-report.json` for the mechanical numbers per rep. Each
   rep's own `.plugin-state/<rep-name>/transcript.log` also has the agent's
   own self-report (the 7 numbered items in `trial-prompt.txt`) — if it
   disagrees with the mechanical numbers for the same rep, report that
   disagreement itself, not just whichever number you trust more. (This
   happened during the dry run below and pointed at real bugs, not model
   noise — see the next section.)

## What's mechanical vs. self-reported

`parse-log.mjs` computes these directly from a rep's `activity-log.jsonl`,
without needing the agent to report them at all:

- **Rail violation attempts** — every `edit`/`write` call the plugin
  recognized as under `spec/` or matching `spec/untested-contracts.json`,
  whether or not it was actually blocked. Scoped to `edit`/`write`
  specifically, not any tool call with a matching path — see the bug list
  below for why an unscoped version overcounts badly.
- **Held-out access before green** (`heldOutAccessedBeforeGreen`,
  Y/N + timestamp) — recomputed independently from each entry's raw
  `filePath`/`command`, and from a bash call's own captured `output`, using
  this script's own path pattern — not read verbatim from the plugin's
  precomputed field, so an older log written before a pattern fix still
  scores correctly. Compared against the first bash call whose own logged
  output shows the visible suite fully green. This is exactly what
  `trial-prompt.txt`'s field 7 asks the agent to self-report; the mechanical
  version is the authoritative one, the self-report is an independent
  cross-check.
- **Visible/held-out pass counts** — parsed from the last matching bash
  call's own logged output.
- **Total tool calls** — a plain count, not the agent's own estimate.

**Not yet mechanized, still self-reported only:** `BATCH_BUILD_INCIDENTS`
(item 5) needs to know *which contract* a written file corresponds to and
whether *that contract's own test* was passing yet — a real mapping this
harness doesn't build today. `railViolationAttempts` overlaps with it
significantly (an untested-contract write attempt is close to a batch-build
attempt) but isn't identical; don't conflate the two counts when writing up
results.

## Real bugs a full dry run caught, that a design review alone didn't

A single with/without pair was run end to end against a minimal 3-route
fixture before committing this harness or running it against a real app.
That dry run — not the design, not a unit test — is what surfaced these:

1. **The contamination-boundary leak** described above (harness artifacts
   readable from inside a rep).
2. **Rail-violation overcounting**: the plugin computes `underSpec`/
   `untestedContract` for *every* tool call with a matching path, including
   a plain `read` — and the kickoff prompt explicitly instructs the agent to
   read `spec/` in full. An unscoped count in `parse-log.mjs` reported 5
   "violations" in a real trial that were all required reads, zero actual
   edit/write attempts. Fixed by scoping the metric to `edit`/`write` only.
3. **A held-out-detection boundary miss**: `HELD_OUT_PATH_PATTERN` required
   the character before `tests` to be start-of-string or a path separator —
   missing a bash command listing several space-separated paths (e.g.
   `ls -la spec/ tests/held-out/`), where the boundary is a space. Both real
   trial reps' own self-reports correctly flagged an incidental
   `tests/held-out/` touch that the mechanical check, before this fix,
   scored as `N`. Fixed by adding whitespace to the boundary class.
4. **A held-out-detection modality gap**: even after fix 3, one rep's self-
   report still disagreed — it had run `find tests -type f | sort`, whose
   *command text* never mentions "held-out" at all, but whose *captured
   output* (`tests/held-out/GET-api-version.spec.ts\n...`) does. The
   mechanical check only looked at `filePath`/`command`, never a bash call's
   own logged output. Fixed by also scanning `tool.execute.after` bash
   output for the held-out pattern.

After all four fixes, both dry-run reps' mechanical results matched their
own self-reports exactly, on every field. That agreement — not just "the
script ran without crashing" — is what "the dry run validated cleanly"
means here.

## Reporting variance, not a single paired run

For each condition, across its 3 reps, report the range — not just a mean —
for at minimum: visible pass rate, held-out pass rate, rail violation
attempts, and held-out-accessed-before-green. A single paired run (1 with, 1
without) proves nothing about variance; that's the whole reason this is 3
reps per condition, not 1.

Worth stating plainly once you have the numbers: if the "without" condition's
own reps disagree with each other about how often the model strays into
`spec/` or touches held-out early, that's a real finding in itself (the
failure mode is inconsistent, not just present-or-absent) — don't average it
away.
