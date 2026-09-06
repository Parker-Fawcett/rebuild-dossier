# Contract-locking ablation, Codex-specific (run via `codex exec`)

Ports the contract-locking ablation ([../README.md](../README.md), OpenCode;
[../claude-code/README.md](../claude-code/README.md), Claude Code) onto
OpenAI's Codex CLI, to extend model-tier coverage beyond Claude
(Haiku/Sonnet) and nemotron — the paper's own explicitly-named limitation
("Not a large-N benchmark... Selection was convenience sampling... reproducible
does not mean representative").

**This harness has never been run against a real, authenticated `codex` CLI.**
There isn't one in the environment this was built in. Everything below marked
"assumed" is inference from third-party web research (Codex's own hook system
is new enough that no first-party documentation was directly consulted),
**not** from either a production code path (like the Claude-Code harness's
strongest claims) or a captured real payload (like its second-strongest). This
is a THIRD, weaker confidence tier the other two harnesses didn't need — treat
every "assumed" row as a hypothesis a real dry run must check, not a fact.

## Confirmed vs. assumed

| Claim | Status |
|---|---|
| Codex CLI has `PreToolUse`/`PostToolUse` hooks, described as modeled on Claude Code's | **Assumed** — third-party web research (multiple independent blog/community sources agree on this), not first-party docs, not a captured payload. |
| Hook config lives at `<repo>/.codex/hooks.json`, format `{ "hooks": { "PreToolUse": [{ "command": "..." }] } }` | **Assumed** — same sourcing. No `matcher` field is documented the way Claude Code's `settings.json` has one — this harness assumes every hook fires for every tool call regardless of type, and is designed defensively around that (see hooks/tool-log.mjs's header). |
| A hook blocks a tool call via exit code 2 + stderr, OR a JSON `permissionDecision: "deny"` response | **Assumed**, exit-code-2 chosen for parity with the Claude-Code harness — if a real dry run shows blocking doesn't happen, try the JSON response shape before assuming something else is wrong. |
| Hook stdin JSON shape (`cwd`, `tool_input.file_path`, `tool_name`, `tool_response.stdout`) | **Assumed by extension** from Claude Code's confirmed shape — hooks/tool-log.mjs and hooks/tool-heartbeat.mjs try several plausible field paths defensively and log the complete raw payload unconditionally, specifically because this is unconfirmed. |
| Codex requires one-time human trust-approval of a hook's exact definition before it runs; a `codex hooks trust approve` command exists with `--source`/`--event`/`--command`/`--json` flags for non-interactive approval | **Assumed** — sourced from a public GitHub issue discussion and third-party guides, not confirmed by running it. **Not automated by setup.sh or run-trial.sh** — see "One-time manual setup" below. |
| `codex exec --sandbox workspace-write --ask-for-approval never --model <model> "<prompt>"` runs headlessly without interactive prompts | **Assumed**, same sourcing. Deliberately avoids the deprecated `--full-auto` flag and `--dangerously-bypass-approvals-and-sandbox` (more than this harness needs). |
| `--full-auto` combined with `--sandbox workspace-write` can hang indefinitely with orphaned child processes on some Codex versions | **Confirmed as a real, publicly-filed bug** (a GitHub issue, not a rumor) — this is why run-trial.sh has a hard wall-clock kill switch neither prior harness needed, and why it avoids `--full-auto` even though avoiding it is not itself confirmed to dodge the same class of hang. |
| Detection logic (spec/ lock, untested-contracts.json lookup) | **Confirmed** — identical to `src/spec/generateSettingsJson.ts`'s production hooks, ported not reimplemented, same as both prior harnesses. |

## Architecture — what's different from the Claude-Code version, and why

Same contamination-boundary principle: every rep, both conditions, gets
byte-identical `.codex/hooks.json` + `.codex/hooks/*.mjs`; the only
difference is a sibling `.codex-plugin-state/<rep-name>/enforce` marker file,
confirmed with `diff -rq` after `setup.sh` runs (this part IS locally
verified — pure filesystem logic, no live `codex` needed).

**Two hook scripts, not four**, unlike the Claude-Code harness's four
(`tool-log.mjs`, `tool-log-readonly.mjs`, `tool-heartbeat.mjs`,
`tool-log-bash-output.mjs`). Codex's documented config has no per-tool
`matcher`, so there's no way to register a hook that only fires for
`Edit|Write` versus `Read|Bash|Glob|Grep` the way Claude Code's does — every
`PreToolUse`-registered script fires for every tool call, and same for
`PostToolUse`. Rather than register redundant copies, `hooks/tool-log.mjs`
absorbs the readonly held-out-detection job (it already sees every tool
call's `filePath`/`command`) and `hooks/tool-heartbeat.mjs` absorbs the
bash-output held-out scan (it already sees every tool call's captured
output). This is a real architectural consequence of Codex's own design, not
an oversight — confirm or correct it once a real payload is captured.

- `hooks/tool-log.mjs` — `PreToolUse`. Logs every call unconditionally (raw
  payload first, then interpreted fields), then blocks under `enforce` the
  same way both prior harnesses' hooks do.
- `hooks/tool-heartbeat.mjs` — `PostToolUse`. Writes a heartbeat + scans
  captured output for an incidental held-out reference.
- `hooks.json.template` — wired to both scripts; copied byte-identical into
  every rep as `.codex/hooks.json`.
- `setup.sh` — builds reps from one `generate_spec` output. Defaults to 1
  rep per condition (dry-run scope), not 3 — raise this only after a real
  dry run passes the checklist below.
- `run-trial.sh` — runs one rep via `codex exec`, polls the heartbeat every
  20s with a hard wall-clock kill switch (see the hang-bug row above),
  independently re-runs both test suites, then computes `summary.json`.
- `run-all.sh` — runs every rep sequentially, aggregates into
  `aggregate-report.json`.
- `parse-log.mjs` — computes mechanical metrics, and additionally surfaces
  `sampleRawStdin`/`hookErrors` fields the other two harnesses' parsers
  don't need — read those first on this harness's first real run.
- `trial-prompt-suffix.txt` — identical self-report protocol both prior
  harnesses use, for the same cross-check purpose.

## One-time manual setup (NOT automated — do this before any real trial)

1. Prepare a rep with `setup.sh` (below).
2. Run `codex` interactively once inside that rep directory, or use
   `/hooks` / `codex hooks trust approve` (exact flags unconfirmed — see the
   table above) to review and trust `.codex/hooks/tool-log.mjs` and
   `.codex/hooks/tool-heartbeat.mjs`. This harness deliberately does not
   guess the right non-interactive command for this and bake it into a
   script — get it wrong silently and every subsequent trial would look like
   "hooks never fired" for a completely different reason than an actual
   payload-shape bug, and the two failure modes would be hard to tell apart
   from `summary.json` alone.
3. Confirm trust actually stuck by making one throwaway tool call inside the
   rep and checking `.codex-plugin-state/<rep-name>/activity-log.jsonl` for a
   `raw-capture` entry. If it's empty, the hooks did not fire — stop and fix
   this before running a real trial, don't proceed and hope `run-trial.sh`
   sorts it out.

## Dry-run checklist — check these against `summary.json` after ONE real rep

Mirrors the Claude-Code harness's own three-question checklist, plus two more
this harness needs because nothing here is confirmed yet:

1. Is `sampleRawStdin` non-empty and valid JSON? If `parseError` is set
   instead, hooks are firing but stdin isn't JSON — check `argv`/env vars in
   the same raw-capture entries for where the real payload actually lives.
2. Do the interpreted fields (`filePath`, `toolNameRaw`, `command`) in
   `before`/`after-heartbeat` entries look populated and sensible, or are
   they all `null`? All-`null` with valid JSON means the field names guessed
   in `extractFilePath`/`extractToolName`/`extractCommand`/`extractOutput`
   are wrong — fix them from the real shape now visible in `sampleRawStdin`,
   not by guessing again.
3. Did a deliberate test edit under `spec/` in a `with-` rep actually get
   blocked (transcript shows Codex reporting a failed edit, exit path via
   `console.error` + code 2), while the identical edit in a `without-` rep
   succeeded?
4. Does `.hook-heartbeat.json` appear in the sibling state directory
   *during* the run (via `liveness-poll.jsonl`), not just after?
5. Did the run complete under the wall-clock cap, or did the timeout
   safeguard actually have to fire? If it fired, that's the documented hang
   bug reproducing here, not a harness bug — report it as a real finding
   about Codex + Terra/Luna specifically, don't just raise the cap and
   rerun.

Only once all five check out is `run-all.sh` worth trusting with a real
Terra/Luna trial. Per both prior harnesses' own documented history: a dry
run, not a design review, is what this project trusts — expect this one to
surface real bugs the same way, and fix them here before scaling to N=3.

## Usage

```bash
# 1. Run ingest_repo + resolve the case queue + generate_spec against a
#    target app once, normally — a minimal fixture for the first dry run,
#    a real app only after the checklist above passes.

# 2. Prepare one rep per condition (dry-run default):
./setup.sh "/path/to/app-rebuild"

# 3. Sanity-check the contamination boundary:
diff -rq "/path/to/ablation-codex-app-rebuild/with-rep1" "/path/to/ablation-codex-app-rebuild/without-rep1"
# expect: no output at all

# 4. Complete the one-time manual hook-trust step above, THEN run a single
#    rep by hand:
./run-trial.sh "/path/to/ablation-codex-app-rebuild/with-rep1" terra

# 5. Work through the dry-run checklist against that rep's summary.json
#    before running anything else, let alone run-all.sh.
```

Pick the model deliberately — no default, same reasoning as both prior
harnesses.
