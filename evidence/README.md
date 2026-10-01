# Per-trial evidence for the SEIP paper

This folder holds the raw, machine-generated record behind the paper's experimental claims: every
agent session's activity log, transcript, independent test re-runs, computed metrics, and (for the
sealed study) the frozen rebuild snapshot that was evaluated. It was packaged on 2026-09-24 from the
author's local run directories, with no files edited. Large files are gzipped deterministically
(`mtime=0`). `SHA256SUMS-original-files.txt` gives the sha256 of every file *before* compression,
so each can be checked against the original.

## Contents

| Path | What it is |
|---|---|
| `manifest.csv` | One row per archived run record (139 rows; **not** 139 unique sessions, see "Duplicate and partial records" below): `canonical_id`, `duplicate_of`, `record_status`, study, paper section, trial ID, arm, CLI and version, model, effort, start/end time, kickoff-prompt sha256, condition markers, visible and held-out results, exported handlers, batch-interval proxy, untested-contract attempts, out-of-tree access, stall, heartbeat count, snapshot sha256. Blank cells mean the study's harness did not record that field. |
| `runs/<study>/<trial>/` | That session's raw files: `activity-log.jsonl.gz` (every tool call the hooks saw), `transcript.log.gz`, `visible-rerun.log` / `held-out-rerun.log` (the harness's own re-runs), `summary.json`, `run-meta.txt`, `liveness-poll.jsonl`, `.hook-heartbeat.json`; sealed study only: `review-metrics.json`, `held-out-sealed.json`, `visible.json`, `sandbox.sb`, `snapshot.tar.gz` plus `snapshot.sha256`. |
| `study-level/` | The run order (seeded), aggregate results, and full run logs for the sealed and wording studies; the package manifest the sealed study was frozen on; the evaluator-side sealed held-out suite (one copy, with a check that all 20 copies are byte-identical). |
| `compute-handler-correlation.mjs` | Recomputes §V-E's supplementary correlation from `runs/sealed-haiku/*/review-metrics.json` and writes `handler-table.csv` (the 20 rows). `node evidence/compute-handler-correlation.mjs` prints ρ = 0.9959393320. |
| `handler-table.csv` | The 20 sealed Haiku runs: arm, exported handlers, held-out obligations passed, visible, batch intervals. |
| `fidelity-oracle/` | The requirements oracle (§V-A), plus `breakdown.mjs`/`breakdown.txt` (by category and route), with its protocol (`PROTOCOL.md`), battery (`fidelity.spec.ts`, `routes.json`), and golden answers from the original at `54d7e65`, all committed before any snapshot was scored (commit `4da1e97`). Also the per-run results for all 30 sealed snapshots, `score.mjs`, `fidelity-scores.csv`, and `score-output.txt`. Author-written; pre-database behavior only. |
| `baselines/constant-200/` | The do-nothing stub that passes every visible and held-out test (§V-A), its outputs, and tested reproduction commands. |
| `mutation-trace/` | Kill-cause trace for three rule-selected routes (§V-B): selection rule, script, results. Uses the current engine; it is not a replay of the July run. |
| `second-app-audit/` | The recipes-api audit (§V-C): the frozen protocol and battery, golden answers, rebuild responses, scorer, the matched-state supplement, and `provenance/` hashes for the withheld rebuild. |
| `external-production-case/` | The non-author operator's run (§V-D): redacted report, route IDs, redacted raw logs, the author's verification record, and what is withheld and why. |

**Condition markers:**
- `enforce`: blocking on (spec lock and untested-contract block).
- `enforce-untested`: untested-contract block only.
- `lock`: the runner's in-progress marker, present in every sealed run; not an experimental
  condition.

The sealed arms are defined in `ablation/review-2026-09/PREREGISTRATION.md` §2:
- **A:** full blocking, discipline prompt.
- **B:** log-only, discipline prompt.
- **C:** log-only, batch-allowed prompt and `CLAUDE.md`.
- **D:** untested-contract block only, discipline prompt.

## Claim → evidence

| Paper claim | Study folder(s) | How to check |
|---|---|---|
| §V-A/§V-E sealed study: per-arm held-out results; 11 runs at exactly 20 handlers score 0/12; 7 discipline-arm over-builders score 2–8/12; both 12/12 in arm C; batch proxy flags 14 of 15 discipline runs | `sealed-haiku` | `manifest.csv`, `handler-table.csv`, per-run `review-metrics.json`; `study-level/sealed-haiku-review-results.json` |
| §V-E supplementary ρ = 0.996 | `sealed-haiku` | `node evidence/compute-handler-correlation.mjs` |
| §V-E ten sealed Sonnet runs never build past demand; two had 3-file intervals | `sealed-sonnet` | `manifest.csv` (`exported_handlers`, `max_new_files_one_interval`) |
| §V-E four-cell design (blocking vs. log-only, both tiers), heartbeat counts; §VI-B the leakage-by-reading 12/12 | `fourcell-catchandtrade` | `summary.json`, `activity-log.jsonl.gz`, `held-out-rerun.log`; `ablation/review-2026-09/ledger.csv` hashes each run's settings |
| §V-F catchandtrade strong-tier corroboration (5 runs) | `fourcell-catchandtrade` (`with-rep-strong1–5`) | `held-out-rerun.log` (`Test Files` vs. `Tests` counts) |
| Temptation-null fixture (0/10) | `temptation-null-mossgate` | `activity-log.jsonl.gz` |
| Leakage-fixed batch (8/8; one blocked, one self-reverted), App. D | `leakage-fixed-duskframe` | `activity-log.jsonl.gz` (`with-rep2` blocked; `without-rep4` write then `rm`) |
| §V-E cross-CLI repetitions (OpenCode muse-spark, Codex gpt-5.5 / 5.6-sol / 5.6-terra / 6-astra) | `crosscli-*`, `astra-diagnostic-*`, `reasoning-control-*` | `summary.json`, `transcript.log.gz` |
| §V-E / App. C randomized wording test (orig 5/5 stall, ctrl 5/5, rev 0/5) and effort follow-up | `astra-wording` | `study-level/astra-results-rescored.json`, per-run `astra-metrics.json`, `study-level/astra-run-order.txt` |
| App. C two exploratory reruns | `astra-clarified-exploratory` | `summary.json`, `transcript.log.gz` |
| §V-F timed cost pair (dossier arm: 24/24 visible, 0/7 held-out, 30 heartbeats) | `catchandtrade-fresh-spec` (`with-rep1`) | `summary.json`, `transcript.log.gz` |
| §V-A constant-200 baseline; §V-B mutation trace; §V-C second application | `baselines/`, `mutation-trace/`, `second-app-audit/` | each folder's README / `TRACE.md` / `PROTOCOL.md` |
| §V-D production case | `external-production-case/` | its `README.md` |

Other folders (`madeline-*`, `subagent-verify`) back findings-log entries that are not paper claims.

**Wording experiment: use the rescored file.** For the randomized wording test and its effort follow-up, the authoritative scores are `study-level/astra-results-rescored.json`, which uses the fixed 20-file visible denominator. The early per-run `astra-metrics.json` files are kept unedited as original records. They used vitest's *collected-case* count, so a stalled one-route run can read `visiblePass: 1, visibleTotal: 1, visibleComplete: true`, which is wrong. The rescoring correction and its timing are documented in the pre-registration's deviations section (`ablation/review-2026-09/PREREGISTRATION.md` §9) and in `rescore-astra.mjs`.

**Failed infrastructure attempts.** The pre-registration (§3.1) keeps each failed infrastructure attempt under `<state>/failed-attempt-N/`. All five that exist are in the wording study:
- `astra-wording/{g55orig-rep3, rev-rep1, rev-rep3, rev-ultra-rep1, rev-xhigh-rep2}/failed-attempt-1/`

Each was a Codex usage-limit stop (the phrase "usage limit" appears in its records) and was re-run once in place, as §3.1 requires. `manifest.csv`'s `failed_attempts_archived` column counts them per run. The sealed Haiku and Sonnet studies had none.

## Duplicate and partial records

The Codex cross-CLI and Astra diagnostic harness ran every trial in one working folder, then copied that folder's state into a per-condition archive folder. When the archive for one condition was made, the working folder still held an earlier trial, which was copied along with it. Four rows are therefore byte-identical copies of a run recorded elsewhere: identical activity log, transcript and summary. `duplicate_of` names the canonical record, which is the copy in its own condition's folder.

| Duplicate row | Canonical record |
|---|---|
| `crosscli-codex-sol-without/with-rep1` | `crosscli-codex-sol-with/with-rep1` |
| `crosscli-codex-web/with-rep1` | `crosscli-codex-sol-with/with-rep1` |
| `crosscli-codex-web/without-rep1` | `crosscli-codex-sol-without/without-rep1` |
| `astra-diagnostic-without/with-rep1` | `astra-diagnostic-with/with-rep1` |

`record_status` also marks:
- **partial records:** rows with an activity log or a transcript but not both, mostly older Codex harness layouts;
- **no session record:** rows whose folder holds only condition markers or a summary, not a trial that ran.

Count unique sessions by `canonical_id` where `duplicate_of` is empty and `record_status` is not "no session record". None of this touches the sealed Haiku (20), sealed Sonnet (10) or wording/effort (27) records, which have no duplicates.

## Not in this bundle, and why

- **The first duskframe leakage batch ("leakage-batch" in earlier paper versions, 9 valid runs).** Its re-run
  against the fixed pipeline was written to the same directory and replaced it. That batch
  survives only as the counts and excerpts recorded at the time in `docs/v0-findings.md`
  ("The duskframe fixture surfaces something bigger…").
- **Ablation reps 1–6 and the original Madeline two-tier transcripts.** These predate this
  harness's logging; the paper already says their transcripts no longer exist.
- **NextTS-Todo-CRUD, notarybox, motion, and the three extra public apps of §V-F.**
  - These were single handoffs run outside this harness.
  - They are documented in `docs/v0-findings.md`.
  - Two of the §V-F apps carry no license, so their source and the contracts that quote it
    are not redistributed.
- **Frozen rebuilds outside the sealed study.** The sealed runs have snapshot tars. Earlier
  harnesses did not freeze a snapshot, so their `visible-rerun.log` / `held-out-rerun.log`
  (taken at session end) are the record.
- **The audited recipes-api rebuild's source.** It is withheld because the original carries no license and the contracts quote it. Per-file sha256 hashes are in `second-app-audit/provenance/`, and a private archive is preserved by the author.
- **Everything proprietary in the production case.** See `external-production-case/README.md`.

## Versions

- **Sealed and wording studies:**
  - the rebuild package is fixed by `ablation/review-2026-09/MANIFEST-setup.sha256`, frozen before
    any agent ran;
  - `study-level/sealed-haiku-package-MANIFEST.sha256` is identical to it;
  - hooks and analysis scripts are in `ablation/review-2026-09/`.
- **The production case** used npm `rebuild-dossier@0.2.14`.
- **CLI and model versions** for each session are in `manifest.csv` (from `run-meta.txt`) where
  the harness recorded them.
