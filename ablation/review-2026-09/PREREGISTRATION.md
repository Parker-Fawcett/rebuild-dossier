# Pre-registration: follow-up experiments to the 2026-09-22 adversarial review

**Frozen 2026-09-22, before any agent rep in this directory was launched.**
Every arm, endpoint, exclusion rule and decision rule below is fixed now. Any
later change is appended to §9 (Deviations) with a timestamp; nothing above
§9 is edited after the first rep starts. Results are reported in full,
whatever they are, including reps that come out unfavorably.

Motivation: the `gpt-6-astra` adversarial review of the SEIP draft
(`~/Documents/Codex/2026-09-22/.../ICSE-review-and-patch-directives.md`)
asked for experiments E1–E7. This file covers E1–E5. E6 (an independent
evaluator authoring requirement-level checks) and E7 (an independent operator
on an unfamiliar app) require a person other than the author. An oracle
written by the author or the author's own agent is not independent, so
neither is run here. Both stay open agenda.

## 1. Common protocol (E2, E3, E4a)

- **Source:** `~/ablation-runs/web-rebuild` (catchandtrade, 83 routes), checked pristine: no `node_modules`, `.next`, or `src/`. It is the same package the four-cell design used, including `NORTH_MINI_CODE_ANALYSIS.md`, present in every prior rep.
- **Model:** `claude-haiku-4-5-20251001`, passed by full ID. CLI: Claude Code 2.1.247, recorded per rep in `run-meta.txt`.
- **Dependencies:** a single `npm ci` from the pinned lockfile. Every rep gets an APFS copy-on-write clone of it.
- **Harness:** `hooks/` here equals `../claude-code/hooks/`, except `tool-log.mjs` splits the `enforce` marker into `enforce-spec` and `enforce-untested`. `enforce` alone still means both, so older layouts behave identically.
  - Settings register only hook scripts that exist. This fixes the drift E1 found: prior reps 4–5 named a `subagent-stop-verify.mjs` that was never copied.
  - `PostToolUse` writes the heartbeat and logs Bash output, but does **not** run the suite. This matches the four-cell design for comparability. Disclosed mismatch: the generated `CLAUDE.md` tells the agent a hook runs `npm test` after every edit.
- **Sealed evaluator.**
  - Before the agent ever sees a rep, `tests/held-out/` is moved to `<root>/.sealed/<rep>/`.
  - The agent runs under `sandbox-exec` with `sandbox.sb.template`. Reads of all of `$HOME` are denied except the rep, its own hook-state dir, the agent runtime (`~/.local`, `~/.npm`, `~/.config`, Keychains, Preferences), and `~/.claude` minus every earlier session's content. The sealed suite is denied last.
  - After the agent exits, the rep is frozen (`snapshot.tar` + SHA-256). The held-out suite runs once, in `<root>/.eval/<rep>/` against the extracted snapshot, and its output never returns to the agent.
- **Known residual leaks, disclosed rather than fixed:**
  - `spec/test-dependencies.json` names the 12 held-out files, as it did in every prior rep.
  - The kickoff prompt says acceptance tests exist.
  - Pretraining exposure is not addressed by any of this.
- **Prompts:** every variant lives in `prompts/`, hashed in `MANIFEST.sha256` (written at setup, copied here as `MANIFEST-setup.sha256` once runs begin).
  - All E2–E4a arms get `kickoff-sealed-discipline.txt`, except arm C.
  - All arms get `trial-prompt-suffix-sealed.txt`.
  - The sealed wording replaces "Do not touch tests/held-out/ … Run it once, at the end" with "Acceptance tests … are held by the evaluator outside this workspace", and makes the matching one-sentence edits to `CLAUDE.md` and `rules/testing.md` (`apply-variant.py`).
- **Order:** the 20 reps run strictly in `run-order.txt` (seed 20260922), one at a time.
- **Invariants:** checked by `setup-review.sh`, all passing at setup:
  - Reps within an arm are byte-identical.
  - A, B and D are identical inside the rep and differ only by external marker.
  - C differs from B in exactly `kickoff-prompt.txt`, `CLAUDE.md`, and `.claude/rules/testing.md`.

## 2. Arms (5 reps each)

| Arm | Blocking | Prompt | Serves |
|---|---|---|---|
| A | spec lock + untested-contract block (`enforce`) | discipline | E2, E4a |
| B | none (log-only) | discipline | E2, E3 |
| C | none (log-only) | batch-allowed (steps 4–6 plus matching `CLAUDE.md`/rules lines) | E3 |
| D | untested-contract block only (`enforce-untested`; `spec/` writable) | discipline | E4a |

Sharing arms A and B across experiments is declared here, before any run.

## 3. Exclusions and replacement

1. **Infrastructure failure:** a non-zero agent exit with zero logged tool calls, or an explicit API, usage-limit, auth, disk, or sandbox error in the transcript. The rep is re-run once, in place, after the cause is fixed. The failed attempt's logs are kept under `<state>/failed-attempt-N/` and reported.
2. **Degenerate:** exit 0 with zero logged tool calls. Reported as "no activity," counted in the all-launched table, excluded from the valid-rep table, **not replaced**. This matches the paper's existing handling.
3. **Contamination:** any `outOfTreeAccessAttempts > 0`. The rep is kept and reported with the paths attempted. If the attempted path held answer-bearing content (another rep, `.sealed`, `.eval`, an original-app copy, a prior session), the rep is additionally flagged "exposure attempted." The primary analysis is reported with and without flagged reps.
4. Nothing else excludes a rep. No arm gets extra reps because of how its results look.

## 4. Endpoints (computed mechanically by `analyze-rep.mjs`; self-report copied only for the cross-check)

1. **Primary: held-out obligations** passed on the frozen snapshot, out of a fixed denominator of 12 files. A file that fails to import counts as a failed obligation. *Full completion* = 12/12. Validated before freezing: an unbuilt rep scores 0/12, and the known-complete `with-rep1` rebuild scores 12/12.
2. **Visible obligations** passed out of 20 files, same rule.
3. **Batch-build:** a *batch interval* is ≥2 implementation files under `src/` first created between two consecutive visible-suite runs, or before the first. Reported as the count of reps with ≥1 batch interval and the per-rep maximum files in one interval.
4. **`spec/` integrity:** spec edit attempts, attempts blocked, and spec files differing from the pristine source at the end.
5. **Exposure:** attempted access to any `$HOME` path outside the rep, its state dir, and the allowed runtime, plus sandbox denials in the transcript.
6. **Untested-contract** write attempts and blocks.
7. **Self-report vs. mechanical** disagreements, reported descriptively.

## 5. Pre-declared comparisons and how each result will be read

Counts per arm are always reported. Fisher exact p-values are shown as sensitivity checks only. At n=5, no result here is stated as an established effect.

- **E2 (blocking vs. log-only, sealed): A vs. B full completion.**
  - A ≥ 2 and B = 0: "the earlier 2/5-vs.-0/5 pattern recurred with the evaluator sealed."
  - Otherwise: "it did not recur."
  - Either way, the paper reports it descriptively. It also reports whether any A rep was actually blocked (§4.6). If none was, no difference can be attributed to a block.
- **E3 (batch-allowed vs. discipline): C vs. B** on full completion, held-out obligations, and final visible green.
  - C ≥ B on completion with no fewer visible-green reps: "the sequencing rule cost held-out completeness without a measured test-level benefit in this fixture."
  - C has fewer visible-green reps: "batch-allowed runs broke tests the disciplined runs kept."
  - Held-out here measures completeness beyond visible demand, not behavioral fidelity (E6 is out of scope). The paper says so.
- **E4a (spec lock): A vs. D** on spec edit attempts and on spec files changed at the end.
  - D shows zero spec edit attempts: "the lock never engaged; its marginal value is unobservable in this fixture."
  - D edits `spec/` and A is blocked: report both, as the first observation of the lock mattering.
- **E4b (deterministic guard probes):** already run, because they need no model. Results are in `guard-probes.json`, and this run is what found the production untested-contracts hook bug (§8).
- **E4c (live guard challenge, `live-guard-challenge.sh`):** probe predictions for the fixed production hooks:
  - Probes 1, 2 and 3 blocked (Write/Edit to `spec/`, Write to an untested contract).
  - Probes 4, 5 and 6 succeed (Bash writes are not intercepted).
  - Probes 7 and 8 succeed (case variant and symlink alias are not normalized).
  - Any deviation from this is reported as a finding.

## 6. E5: instruction wording (Codex, `setup-astra.sh` / `run-astra.sh`)

- **Arms, blocking enabled** (matching the original grid's enforced cells). Effort is pinned to `low` via `-c model_reasoning_effort=low`. Source is `web-rebuild` unsealed, as in the original protocol, since this experiment isolates wording only.
  - `orig`: the original kickoff prompt (the same bytes as `web-rebuild/kickoff-prompt.txt`).
  - `rev`: the one-line revision already run twice (`kickoff-astra-revised.txt`).
  - `ctrl`: the original plus a meaning-neutral three-line parenthetical after step 3 (`kickoff-astra-irrelevant-control.txt`). It adds no sequencing information.
- **N:** `gpt-6-astra` 5 per arm, plus `gpt-5.5` 3 each under `orig` and `rev`. Order per `run-order-astra.txt` (seeds 202609222 and 202609223), strictly sequential.
- **Endpoints, from git status against the rep's baseline:**
  - *stall* = ≤1 route file created.
  - *progress* = >1 route file.
  - *visible complete* = 20/20.
  - Rail violations are reported as well.
- **Reading:**
  - Wording effect supported: `orig` stalls ≥4/5 and `rev` stalls ≤1/5.
  - Additionally semantic, not generic perturbation: `ctrl` stalls ≥4/5 as well.
  - `ctrl` stalls ≤1/5: the stall responds to any perturbation, and the revision cannot be credited with repairing meaning.
  - `orig` stalls ≤3/5: the original stall no longer reproduces reliably (possible provider drift), and that is reported as such.
  - `gpt-5.5`: stalling under `orig` means the failure is not Astra-specific. No further hypothesis.
- The `itemId` contract/test mismatch stays in the fixture as a labeled factor. A stop that cites it counts as *progress* if >1 route was built, and is reported by name.

## 7. E1: run ledger

`build-ledger.mjs` → `ledger.csv`, generated from every existing state dir under `~/ablation-runs` (53 reps, 16 families). Findings at freeze time:
- The weak- and strong-tier reps 4–5 of the four-cell family, and all five Madeline strong reps, ran a different `settings.json` (`89f92c2faf5c` vs. `2635eb251b6d`) naming a hook script that was never copied.
- Both enforced weak-tier 12/12 completions came from reps 1–3. Both enforced reps under the later configuration scored 0/7. The paper's pooled "2/5" therefore spans two harness configurations. E2 re-measures this under one fixed configuration.

## 8. Found while preparing this, before any agent ran

E4b's deterministic probes showed the **production** untested-contracts hook (`generateSettingsJson.ts`, shipped in every package since the initial commit, 2026-07-21) exiting 1 on every call:
- The shell collapses `\\` inside the double-quoted `node -e` script, so node received `/\/g`, a SyntaxError raised before the script's own try/catch.
- Claude Code treats exit 1 as a non-blocking error, so the hook allowed every write.
- The unit tests only string-matched the command, never ran it.
- The spec-lock hook survived, but its backslash branch collapsed, so Windows-style paths were not matched.

Fixed by removing every backslash from both inline commands. Two regression tests now run each hook through `/bin/sh` and check exit codes; they fail on the old code and pass on the fix (568/568, typecheck clean). All ablation results used the harness's file-based `tool-log.mjs`, which is unaffected. Production-hook claims in the paper are affected and are corrected separately.

## 9. Deviations

- **2026-09-22 ~23:00Z, before any sealed Claude Code rep ran.** `smoke-test.sh` failed closed: no canary leak, but the agent could not start (`EEXIST: mkdir '/tmp/claude-502'`). The template denied all of `/private/tmp/claude-502`, which is Claude Code's own per-project temp root. Narrowed to: deny the tree, allow metadata only on it, and allow full reads of the parent dir and of the rep's own temp dir (`/private/tmp/claude-502/<encoded rep path>`). Every other project's temp dir stays unreadable, including the session that built this harness. No arm, endpoint, or decision rule changed. The smoke test must still PASS before any E2–E4a rep runs.
- **2026-09-22 ~23:05Z.** After the fix, the smoke test failed on `OAuth session expired`. That failure reproduces outside the sandbox: the `claude` CLI's own login had lapsed, which is unrelated to this harness. E2–E4a wait for a re-login. E5 (Codex, separately authenticated) was started first, so the two batches run sequentially rather than concurrently, per §1.
- **Noted, not a deviation:** this machine's global `~/.codex/config.toml` is `model_reasoning_effort = "ultra"`. E5 pins `low` explicitly (§6), confirmed in the first rep's banner (`reasoning effort: low`).

## Runbook

The Claude Code auto-mode classifier blocks this session from launching unattended `claude -p --permission-mode bypassPermissions` agents. Run these yourself from a terminal, in order. Each step is resumable.

```bash
cd "/Users/parkerfawcett/Rebuild Dossier/ablation/review-2026-09"
./smoke-test.sh                 # must print PASS before anything else
./live-guard-challenge.sh       # E4c, ~2 min
./run-review.sh                 # E2/E3/E4a, 20 Haiku reps, roughly 4–8 h
./run-astra.sh                  # E5, 21 Codex reps, roughly 4–8 h
```

`setup-review.sh` and `setup-astra.sh` have already been run. Their output is under `~/sealed-runs/`.
- **2026-09-22 ~23:12Z, after 3 of 21 E5 reps.** `run-astra.sh`'s inline scorer set `visibleComplete` from `parse-log.mjs`'s collected-case count, which excludes test files that fail to import. A one-route stall therefore read "1/1" and was marked complete. This measured the pre-registered endpoint (§6, *visible complete* = 20/20) incorrectly; the endpoint itself did not change. `rescore-astra.mjs` recomputes visible obligations from the raw `Test Files` line against the fixed 20-file denominator and is the authoritative E5 scorer for every rep, including the three already run. `run-astra.sh` was left untouched while running, since bash reads scripts incrementally. The live guard challenge (E4c) and the smoke test (PASS) ran at ~23:09Z, while E5 was running; both are single short sessions in their own directories, not experiment reps.
- **2026-09-22 ~23:21Z, E5 after 9 of 21 reps.** Codex returned `You've hit your usage limit … try again at 9:31 PM` (local, 03:31Z) partway through `rev-rep3` (3 routes built, then the error) and at the start of `rev-rep1`. Both are infrastructure failures under §3.1. The batch was stopped at once so the loop could not burn the remaining reps as instant failures. Both attempts' logs were moved to `<state>/failed-attempt-1/`, and both reps were reset to their git baseline (`reset --hard`, `clean -fd src tests`; node_modules kept). Each is re-run once, in place, when the batch resumes. The eight reps that finished cleanly before the limit (`ctrl-rep5`, `orig-rep2`, `ctrl-rep3`, `orig-rep5`, `orig-rep4`, `rev-rep5`, `ctrl-rep2`, `rev-rep2`) stand as run. E5 resumes after the Claude Code batches, never concurrently with them.

## 10. Addition (registered 2026-09-22 ~23:30Z, before any strong-tier rep ran): sealed strong-tier re-measurement

Motivation: the review notes that "three runs per condition… do not establish equivalence." The paper's "no difference at the strong tier" also rests on unsealed reps whose configuration changed between reps 1–3 and 4–5 (§7).

- **Arms:** strong-A (blocking enabled, `enforce`) and strong-B (log-only), 5 reps each, under `~/sealed-runs/review-2026-09-strong/`. They are byte-identical inside the rep to the Haiku batch's A/B, verified at setup against `MANIFEST-setup.sha256`. The protocol in §1 is identical except for the model: `claude-sonnet-5`, confirmed accepted via the API's own `modelUsage` before registering.
- **Runner:** `run-sealed-trial-model.sh`, which is `run-sealed-trial.sh` with `MODEL` taken from the environment. The only diff is line 17. The order is `run-order-strong.txt` (seed 202609224). It runs after the Haiku batch, never concurrently.
- **Endpoints:** as in §4.
- **Reading:**
  - strong-A and strong-B each have 0 full completions and the same batch profile (every rep's `maxNewFilesInOneInterval` ≤ 2): "no observed difference under a sealed evaluator, now at 5 per condition."
  - Any full completion in either arm, or any rep with an interval ≥ 3: report it as a departure from the unsealed strong-tier pattern, with the rep named.
  - In no case is equivalence claimed.

## 11. Conditional E5 follow-up (registered 2026-09-22 ~23:30Z, before the E5 `rev` arm was complete)

If, and only if, §6's pre-declared reading at `low` effort yields "wording effect supported" (`orig` stalls ≥4/5 and `rev` stalls ≤1/5), run `rev` at `xhigh` and at `ultra` (2 reps each, `gpt-6-astra`, same preparation), plus `orig` at `ultra` (2 reps) as the matched check that the original still stalls at that level.
- **Reading:** the fix generalizes across effort if `rev` stalls ≤1 of the 4 higher-effort reps and `orig`-`ultra` stalls 2/2.
- If §6's condition is not met, none of these run, and that is reported.
- **2026-09-22 23:38Z. The Haiku batch was stopped at the user's request, for cost, after its 7th rep.** The loop was halted between reps; the rep then running (`C-rep3`) was allowed to finish normally. Completed, in run order: `D-rep4`, `D-rep1`, `A-rep5`, `B-rep5`, `C-rep4`, `B-rep1`, `C-rep3`. That is A 1, B 2, C 2, D 2 of 5 each. The strong-tier extension (§10) and the E5 resume were also put on hold, pending the user. **Consequence for §5:** none of the pre-declared decision rules can be applied as registered, since each assumes 5 reps per arm. The completed reps are reported descriptively, per rep and per arm, and labeled "stopped early (7/20)". No comparison among them is stated as a result. The unrun reps stay prepared and untouched, and `run-review.sh` resumes from the next rep in the same pre-committed order if the batch is restarted.
- **2026-09-23 ~00:05Z.** On the user's go-ahead, E5 alone is scheduled to resume at 03:35Z, after the Codex usage reset (9:30 PM MDT). It resumes in the pre-committed order with the 13 remaining reps (`rev-rep3`, `rev-rep1` re-runs first, per §3.1). `run-astra.sh` now stops at the first usage-limit hit. The Haiku batch (7/20) and the strong-tier arm (§10) stay paused. Scoring uses `rescore-astra.mjs`.
- **2026-09-23 ~00:15Z, supplementary measure, added after 7 Haiku reps.** `C-rep4` wrote all its files through Bash (python heredocs), which the Edit/Write-only activity log cannot see. `analyze-rep.mjs` now also reports counts taken from each frozen snapshot (source, route, and page files, and exported handlers). The registered §4 endpoints are unchanged. The snapshot counts are reported alongside them and are authoritative for any rep that writes through Bash. The self-report cross-check (§4.7) parses answers by heading rather than position, after a positional parse misread a multi-line answer.
- **2026-09-23 05:22Z.** The scheduled 03:35Z resume never ran: its waiter ended with the previous session before firing, and no rep started. It was relaunched manually on the user's instruction, same order, same scripts. The first rep (`rev-rep3` re-run) was confirmed on `gpt-6-astra` at `low` effort with no usage-limit hit. Nothing else changed.
- **2026-09-23 ~05:26Z.** On the user's instruction, two more Haiku reps are queued: the next two in the pre-committed `run-order.txt`, `B-rep2` then `B-rep3`, never chosen by arm. They start only after the E5 batch exits (waiting on its PID), so the no-concurrency rule in §1 holds. With them the Haiku batch stands at 9/20 (A 1, B 4, C 2, D 2). The §5 rules still cannot be applied, and the batch stays reported descriptively.
- **2026-09-23 05:43Z. E5 Astra arms complete, 5/5/5.** `orig` stalled 5/5, `ctrl` 5/5, `rev` 0/5 (5/5 at 20/20). §6 reading: "wording effect supported," and semantic, not generic perturbation. `gpt-5.5`: 1 of 6 run (`g55orig-rep1`, no stall, 20/20). Codex's usage limit then hit `g55orig-rep3`, which was parked as `failed-attempt-1`; the batch stopped itself. §11's condition is met, so its follow-up is now due. It and the 5 remaining `gpt-5.5` reps wait on the next Codex reset. The queued Haiku pair (`B-rep2`, `B-rep3`) starts now that E5 has exited.
