# Contract-locking ablation, Claude-Code-specific (run via `claude -p`)

Ports the OpenCode ablation ([../README.md](../README.md), [../activity-log.ts](../activity-log.ts))
onto Claude Code's own native hooks and a real `claude -p` subprocess, to answer the paper's
highest-priority open item (docs/v0-findings.md's Section 5.4 note): whether Section 4.9's
weak-tier catchandtrade result — spec-plus-rails batch-building with the mechanical hook
confirmed *dead* — looks different under a hook confirmed *live*, on Claude Code specifically,
rather than OpenCode.

## Why this needed a new harness, not just re-running the old one

Section 4.5 established that Claude Code's `Agent` tool never consults a target directory's own
`.claude/settings.json` — a subagent's hooks bind to the top-level session's root configuration
instead. Every prior Claude-Code-specific comparison that used the `Agent` tool for "a fresh
session" was therefore not testing what it claimed to.

Confirmed live (docs/v0-findings.md, "Closing part of the Claude-Code-specific hook-liveness
gap"), on a real machine, twice, reproducibly: a `claude -p` subprocess launched from *outside*
any existing session, pointed at a fixture directory, **does** consult that directory's own
`.claude/settings.json`. That's the mechanism this harness is built on.

## What's confirmed vs. assumed — read this before trusting a real trial

Everything below marked "confirmed" is backed by either this project's own existing production
code (`src/spec/generateSettingsJson.ts`, already validated across every trial in Sections
4.2–4.12) or a direct test run in this session. Everything marked "assumed" is a reasonable
inference this harness has NOT independently verified, and the first real dry run (see below)
should check it before any real result is trusted — the same discipline the OpenCode harness's
own README documents four real bugs a dry run caught that a design review alone didn't.

| Claim | Status |
|---|---|
| PreToolUse hook JSON has `cwd` and `tool_input.file_path` | **Confirmed** — `test/unit/spec/generateSettingsJson.spec.ts` constructs exactly this shape against production hooks already validated live in Sections 4.2–4.12. |
| A plain `claude -p` invocation (no `--bare`, no `--safe-mode`) reads and enforces the target directory's `.claude/settings.json` | **Confirmed live**, twice, reproducibly (docs/v0-findings.md). |
| `--permission-mode bypassPermissions` and `--allowedTools` avoid interactive approval prompts during an unattended run | **Confirmed against this machine's real `claude --help` output** — both flags exist and are documented that way. |
| A Bash tool call exposes its command string as `tool_input.command` | **Assumed**, not confirmed anywhere in this project's own code (production hooks only ever match `Edit\|Write`, never `Bash`). This is the single largest unverified assumption `hooks/tool-log-readonly.mjs` depends on. **Check this in the first dry run** — if wrong, `command` will be `undefined` in every logged entry and `heldOutTouchCount` will silently undercount bash-based touches (Read-based touches, via `tool_input.file_path`, are unaffected either way). |
| Multiple pipe-separated tool names in a hook `matcher` (e.g. `"Read\|Bash\|Glob\|Grep"`) work the same way `"Edit\|Write"` already does in production | **Assumed by extension**, not separately confirmed — production only ever uses the two-tool form. |
| Two separate hook entries for the same event (PreToolUse `Edit\|Write` and PreToolUse `Read\|Bash\|Glob\|Grep`) both actually run, uninterrupted by each other | **Deliberately not depended on either way** — each of this harness's own hook scripts is self-contained per matcher, and the OpenCode ablation's own hard lesson (a blocking hook can silently stop a sibling hook for the same tool call) is sidestepped by construction rather than answered, exactly as that project's own README recommends when the underlying platform behavior is unknown. |

## Where this harness deliberately does *less* than the OpenCode version, and why

The OpenCode ablation's `parse-log.mjs` scrapes a bash tool call's own captured *output* to detect
when the visible suite went fully green and to catch an incidental held-out-path mention in
command output text (e.g. `find tests -type f | sort`, whose command text never says "held-out"
but whose output does). That required confirming OpenCode's `tool.execute.after` output shape —
done there, by direct test.

This harness has **not** independently confirmed Claude Code's PostToolUse `tool_response`
schema, and deliberately avoids depending on it: `hooks/tool-heartbeat.mjs` only needs `cwd`
(confirmed), never the tool's actual output. The cost of this choice: this harness cannot detect
a held-out touch buried only in a bash command's *output* rather than its *command text* — a
real, named gap (see `parse-log.mjs`'s own comment on `heldOutTouchCount`), not silently routed
around. What replaces the OpenCode version's live-scraped visible-suite-green detection: `run-trial.sh`
independently re-runs both test suites itself after the trial ends, exactly matching this paper's
own dominant verification standard elsewhere ("independently verified by re-running both suites
and reading actual error output," Sections 4.2/4.3/4.7/4.8) rather than the OpenCode ablation's
narrower mechanical-parser standard.

## Architecture

Same contamination-boundary principle as the OpenCode harness, confirmed live in this session
(a `diff -rq` between a fresh with-rep and without-rep against a fixture produced zero
output — see the commit history for this file): every rep, in both conditions, gets the
IDENTICAL `.claude/settings.json` and `.claude/hooks/*.mjs` scripts. The only thing that differs
is a single `enforce` marker file, and it lives in a **sibling** `.claude-plugin-state/<rep-name>/`
directory — never inside the rep — for the same reason the OpenCode harness's own README gives:
a real session's own directory listing would otherwise surface it.

- `hooks/tool-log.mjs` — PreToolUse, matcher `Edit|Write`. Logs every attempt unconditionally,
  then enforces the spec/-lock and untested-contracts rules only if the external `enforce` marker
  exists. Detection logic ported directly from `src/spec/generateSettingsJson.ts`'s own production
  hooks, not reimplemented.
- `hooks/tool-log-readonly.mjs` — PreToolUse, matcher `Read|Bash|Glob|Grep`. Log-only, never
  blocks in either condition. Exists only to catch a held-out touch that doesn't go through
  Edit/Write at all.
- `hooks/tool-heartbeat.mjs` — PostToolUse, matcher `Edit|Write`. Writes a heartbeat to the same
  sibling state directory on every real edit — ported from this project's own production
  `WRITE_HOOK_HEARTBEAT_COMMAND`.
- `settings-template.json` — wires the three scripts together; copied byte-identical into every rep.
- `setup.sh` — builds N with-reps + N without-reps from one `generate_spec` output.
- `run-trial.sh` — runs one rep: launches `claude -p` in the background, polls the heartbeat file
  every 20s for the run's full duration (not reconstructed afterward — matching Section 4.9's own
  standard), then independently re-runs `tests/visible` and `tests/held-out` itself.
- `run-all.sh` — runs every rep sequentially, aggregates `summary.json` files into one report.
- `parse-log.mjs` — computes mechanical metrics per rep from `activity-log.jsonl`,
  `liveness-poll.jsonl`, and the two independent test-rerun logs.
- `trial-prompt-suffix.txt` — the same structured self-report fields the OpenCode harness uses,
  concatenated onto the rep's own freshly-generated `kickoff-prompt.txt` at run time (not a
  second hardcoded copy of it — a real, deliberate improvement over the OpenCode harness, which
  hardcodes the kickoff prompt text and could silently drift from what `generate_spec` actually
  produces).

## What's been verified so far, and what still needs a real dry run

Verified in this session, without needing a live `claude` session (pure filesystem/hook logic):

- `setup.sh` against a minimal fixture — produced byte-identical with/without reps, marker only
  in the sibling state directory.
- `hooks/tool-log.mjs` — correctly blocked a `spec/` edit and an untested-contract write when
  `enforce` was present, correctly logged-but-allowed the identical calls when it wasn't.
- `hooks/tool-log-readonly.mjs` — correctly caught a space-boundary held-out reference in a bash
  command's text (the exact shape of bug the OpenCode ablation's own dry run found).
- `hooks/tool-heartbeat.mjs` — correctly wrote and incremented the heartbeat file.
- `parse-log.mjs` — correctly computed every field against a real activity log plus synthetic
  liveness-poll and test-rerun data.

**Not yet verified, because it requires a real, authenticated `claude` CLI this environment does
not have:** an actual end-to-end `claude -p` trial. Before trusting any real result from
`run-all.sh` against a real app, run ONE trial by hand first and check:

1. Does `activity-log.jsonl` contain entries with a sensible `toolNameRaw` field? (Confirms the
   assumed field name, or reveals the real one to fix.)
2. Does a bash-based held-out touch (not a `Read` one) actually get logged with `touchesHeldOut:
   true`? (Confirms the `tool_input.command` assumption above.)
3. Does `.hook-heartbeat.json` actually appear in the sibling state directory during the run, not
   just after it? (Confirms `run-trial.sh`'s live polling is actually observing something real.)

This mirrors the OpenCode harness's own explicit lesson: a full dry run, not a design review
alone, is what this project trusts.

## Usage

```bash
# 1. Run ingest_repo + resolve the case queue + generate_spec against your target app once,
#    normally, exactly as the main README describes.

# 2. Prepare reps (3 per condition, matching Sections 4.5/4.9/4.11's own convention):
./setup.sh "/path/to/app-rebuild" 3

# 3. Sanity-check the contamination boundary before trusting anything:
diff -rq "/path/to/ablation-cc-app-rebuild/with-rep1" "/path/to/ablation-cc-app-rebuild/without-rep1"
# expect: no output at all

# 4. Run everything (sequential, not parallel — see run-all.sh header):
./run-all.sh "/path/to/ablation-cc-app-rebuild" haiku

# 5. Read aggregate-report.json. Report the RANGE per condition, not just a mean — same
#    reasoning as ../README.md.
```

Pick the model deliberately (Section 4.9's own weak-tier result used Haiku throughout) — there is
no default, on purpose, matching the OpenCode harness's `run-trial.sh`.
