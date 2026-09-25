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
| `manifest.csv` | One row per agent session (139 rows): study, paper section, trial ID, arm, CLI and version, model, effort, start/end time, kickoff-prompt sha256, condition markers, visible and held-out results, exported handlers, batch-interval proxy, untested-contract attempts, out-of-tree access, stall, heartbeat count, snapshot sha256. Blank cells mean the study's harness did not record that field. |
| `runs/<study>/<trial>/` | That session's raw files: `activity-log.jsonl.gz` (every tool call the hooks saw), `transcript.log.gz`, `visible-rerun.log` / `held-out-rerun.log` (the harness's own re-runs), `summary.json`, `run-meta.txt`, `liveness-poll.jsonl`, `.hook-heartbeat.json`; sealed study only: `review-metrics.json`, `held-out-sealed.json`, `visible.json`, `sandbox.sb`, `snapshot.tar.gz` plus `snapshot.sha256`. |
| `study-level/` | The run order (seeded), aggregate results, and full run logs for the sealed and wording studies; the package manifest the sealed study was frozen on; the evaluator-side sealed held-out suite (one copy, with a check that all 20 copies are byte-identical). |
| `compute-handler-correlation.mjs` | Recomputes §V-A's supplementary correlation from `runs/sealed-haiku/*/review-metrics.json` and writes `handler-table.csv` (the 20 rows). `node evidence/compute-handler-correlation.mjs` prints ρ = 0.9959393320. |
| `handler-table.csv` | The 20 sealed Haiku runs: arm, exported handlers, held-out obligations passed, visible, batch intervals. |
| `external-production-case/` | The outside operator's run (§V-C): redacted report, route IDs, redacted raw logs, the author's verification record, and what is withheld and why. |

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
| §V-A sealed study: per-arm held-out results; 11 runs at exactly 20 handlers score 0/12; 7 discipline-arm over-builders score 2–8/12; both 12/12 in arm C; batch proxy flags 14 of 15 discipline runs | `sealed-haiku` | `manifest.csv`, `handler-table.csv`, per-run `review-metrics.json`; `study-level/sealed-haiku-review-results.json` |
| §V-A supplementary ρ = 0.996 | `sealed-haiku` | `node evidence/compute-handler-correlation.mjs` |
| §V-A ten sealed Sonnet runs never build past demand; two had 3-file intervals | `sealed-sonnet` | `manifest.csv` (`exported_handlers`, `max_new_files_one_interval`) |
| §V-A four-cell design (blocking vs. log-only, both tiers), heartbeat counts, the leakage-by-reading 12/12 | `fourcell-catchandtrade` | `summary.json`, `activity-log.jsonl.gz`, `held-out-rerun.log`; `ablation/review-2026-09/ledger.csv` hashes each run's settings |
| §V-E catchandtrade strong-tier corroboration (5 runs) | `fourcell-catchandtrade` (`with-rep-strong1–5`) | `held-out-rerun.log` (`Test Files` vs. `Tests` counts) |
| Table II temptation-null (0/10) | `temptation-null-mossgate` | `activity-log.jsonl.gz` |
| Table II leakage-fixed (8/8; one blocked, one self-reverted) and App. D | `leakage-fixed-duskframe` | `activity-log.jsonl.gz` (`with-rep2` blocked; `without-rep4` write then `rm`) |
| §V-B cross-CLI repetitions (OpenCode muse-spark, Codex gpt-5.5 / 5.6-sol / 5.6-terra / 6-astra) | `crosscli-*`, `astra-diagnostic-*`, `reasoning-control-*` | `summary.json`, `transcript.log.gz` |
| §V-B / App. C randomized wording test (orig 5/5 stall, ctrl 5/5, rev 0/5) and effort follow-up | `astra-wording` | `study-level/astra-results-rescored.json`, per-run `astra-metrics.json`, `study-level/astra-run-order.txt` |
| App. C two exploratory reruns | `astra-clarified-exploratory` | `summary.json`, `transcript.log.gz` |
| §V-G timed cost pair (dossier arm: 24/24 visible, 0/7 held-out, 30 heartbeats) | `catchandtrade-fresh-spec` (`with-rep1`) | `summary.json`, `transcript.log.gz` |
| §V-C production case | `external-production-case/` | its `README.md` |

Other folders (`madeline-*`, `subagent-verify`) back findings-log entries that are not paper claims.

## Not in this bundle, and why

- **The first duskframe leakage batch (Table II "leakage-batch", 9 valid runs).** Its re-run
  against the fixed pipeline was written to the same directory and replaced it. That batch
  survives only as the counts and excerpts recorded at the time in `docs/v0-findings.md`
  ("The duskframe fixture surfaces something bigger…").
- **Ablation reps 1–6 and the original Madeline two-tier transcripts.** These predate this
  harness's logging; the paper already says their transcripts no longer exist.
- **NextTS-Todo-CRUD, notarybox, motion, and the three extra public apps of §V-J.**
  - These were single handoffs run outside this harness.
  - They are documented in `docs/v0-findings.md`.
  - Two of the §V-J apps carry no license, so their source and the contracts that quote it
    are not redistributed.
- **Frozen rebuilds outside the sealed study.** The sealed runs have snapshot tars. Earlier
  harnesses did not freeze a snapshot, so their `visible-rerun.log` / `held-out-rerun.log`
  (taken at session end) are the record.
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
