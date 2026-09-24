# Handoff playbook: rebuild-dossier paper + ablation harness

Written 2026-09-22 for a new agent picking this project up. Covers the paper ecosystem, the
ablation harness (how trials actually get run, verified, and reported), the hard-won gotchas,
and the scientific-integrity rules that govern every number in the paper. Read this before
touching either the manuscript or the harness.

## 1. The paper ecosystem — three documents, one relationship

| Document | Path | Role |
|---|---|---|
| SEIP submission | `/Users/parkerfawcett/Desktop/Cusf:Isef/seip-submission/rebuild-dossier-seip.tex` (+ `.pdf`) | The actual submission target: ICSE 2027 SEIP track, deadline **Oct 23, 2026**. IEEEtran, 10pt, conference. **Hard 10-page cap.** |
| arXiv extended report | `/Users/parkerfawcett/Downloads/rebuild-dossier-paper-draft_5-tables-fixed.tex` (+ `.pdf`) | arXiv:2608.23616. Longer, pandoc-generated `article` class. Cited from the SEIP paper as `fawcett2026arxivreport` in `references.bib`. |
| Findings log | `/Users/parkerfawcett/Rebuild Dossier/docs/v0-findings.md` | The running lab notebook — every real finding, bug, and experiment gets appended here chronologically as a new `## `-headed section, in discovery order. **Never edited or retracted retroactively** — if a later finding supersedes an earlier one, a new section says so; the old one stays as the historical record. |

**Critical rule about how these three relate (established after a real reviewer critique):** the
SEIP paper must be **self-contained**. Never describe the arXiv report as "continuously updated"
or "living" in the SEIP paper's own text — that signals to a reviewer that the submitted paper
isn't self-contained and the target is moving. The current, correct wording (Artifact Availability
section) is:

> "Core claims rest on the tables and logs in this paper; a frozen mirror with per-trial logs and
> supplementary experiments, archived at the version DOI above, is on arXiv... for convenience only."

The arXiv document itself is allowed to keep evolving — the rule is only about how the *SEIP paper's
own text* describes it. See `feedback_supplement_framing_self_contained.md` in the auto-memory
directory for the full reasoning (a fast reviewer reads "living document" as "not self-contained,"
even if true).

**As of this handoff:** the SEIP paper is frozen and submission-ready (10 pages, 0 compile errors,
0 undefined citations). The arXiv report has **not** been updated to match the SEIP paper's latest
changes (N=5 catchandtrade corroboration, inferential-verb fixes, etc.) — that's the one known
inconsistency left, flagged but not acted on. Decide with the user whether to sync it before
touching either document again.

## 2. The ablation harness — where it lives, how it's structured

Root: `/Users/parkerfawcett/Rebuild Dossier/ablation/`

```
ablation/
├── README.md                    # OpenCode-based contract-locking ablation (original)
├── activity-log.ts              # OpenCode plugin: logs + enforces in one hook (see §4)
├── claude-code/                 # Claude-Code-specific port (claude -p, native hooks)
│   ├── README.md                 # Read this first — explains why this harness exists
│   ├── setup.sh                  # Prepares N rep dirs from a source app-rebuild dir
│   ├── run-trial.sh              # Runs ONE rep: claude -p, heartbeat poll, independent re-run
│   ├── run-all.sh                # Runs every rep in a prepared dir, aggregates
│   ├── settings-template.json    # The hooks every rep gets (identical with/without)
│   └── hooks/                    # tool-log.mjs, tool-heartbeat.mjs, tool-log-readonly.mjs, etc.
├── codex/                        # OpenAI Codex CLI variant
└── strong-tier-single-prompt/    # No-spec, no-rails baseline trials
```

Existing rep data (already-run trials, real evidence behind the paper's numbers) lives outside
the repo, under `/Users/parkerfawcett/ablation-runs/`:

```
/Users/parkerfawcett/ablation-runs/
├── web-rebuild/                          # PRISTINE catchandtrade source (never built) — copy
│                                          # from this to make new reps, never run trials in it directly
├── ablation-cc-web-rebuild/               # The main four-cell harness output
│   ├── with-rep1..5, without-rep1..5      # weak tier (haiku)
│   ├── with-rep-strong1..5                # strong tier (sonnet) — no without-rep-strong4/5
│   ├── without-rep-strong1..3
│   └── .claude-plugin-state/<rep-name>/   # activity-log.jsonl, summary.json, transcript.log, etc.
└── madeline-strong-reps/                  # 5 prospective Madeline reps (not in the paper — see §5.5, §6)
```

Source for Madeline reps: `/Users/parkerfawcett/test 7/Madeline-rebuild` (pristine, current spec:
4 page + 2 gate visible, 1 held-out, 3 weak — matches the paper's "8 page tests plus the 2 gate
tests" description).

## 3. Running a new trial — exact steps

**Step 0 — check disk space first.** `df -h /`. A full disk mid-run produces silent, partial
corruption (missing `activity-log.jsonl`, truncated logs) that looks like a crash, not an
obviously-labeled error. This happened once this session and cost a full rep. If low, only ever
delete `node_modules`/`.next` under old `ablation-*`/`test-*` scratch directories — never delete
`.claude-plugin-state/` (real data) or a `web-rebuild`/`Madeline-rebuild` source dir.

**Step 1 — get a pristine source.** Either an existing untouched copy (check for absence of
`node_modules`, `.next`, `src/` build output), or freshly `ingest_repo` + `generate_spec` against
the target app.

**Step 2 — prepare rep directories.** Two paths depending on what you're testing:

- **Testing the enforcement toggle itself** (with vs. without hooks): use `setup.sh
  <source-dir> <reps-per-condition>`. It creates `with-repN`/`without-repN` pairs, copies the
  harness's own `hooks/` + `settings-template.json` into each (always present, only the sibling
  `.claude-plugin-state/<rep>/enforce` marker file differs), and cleans `node_modules`/`.next`.
- **Just replicating a plain handoff** (not testing enforcement — e.g. the catchandtrade/Madeline
  "headline" scenario): copy the source manually, then still apply the harness's `hooks/` +
  `settings-template.json` on top (see the gotcha in §4 about why — do **not** leave the source's
  own real production `settings.json` in place), touch `enforce` since production always
  enforces.

**Step 3 — run.** `run-trial.sh <rep-dir> <model>` (no default model — pick deliberately, e.g.
`haiku` or `sonnet`, not whatever the CLI defaults to). Sequential only — `run-all.sh`/manual
loops never run reps concurrently against a shared machine; that hasn't been tested as safe.
Prefer running in the background (this session used the Bash tool's `run_in_background: true`)
since a single strong-tier catchandtrade rep can take 15–40 minutes.

**Step 4 — read the results, don't trust the agent's own claims.** `run-trial.sh` already
independently re-runs `tests/visible` and `tests/held-out` itself and parses the real vitest
output — that's what ends up in `summary.json`. Always check `activity-log.jsonl` /
`held-out-rerun.log` directly for anything surprising rather than taking `summary.json`'s numbers
at face value (see the two gotchas below — both were only caught by reading raw logs).

## 4. Gotchas that will burn you if you skip them

**Gotcha 1 — production hooks and the ablation harness's hooks write heartbeat to different
paths.** `run-trial.sh` polls `$STATE_DIR/.hook-heartbeat.json` (a *sibling* directory next to the
rep). The harness's own `tool-heartbeat.mjs` writes there. A rebuild package's real, unmodified
production `.claude/settings.json` (from `generateSettingsJson.ts`) writes heartbeat *inside the
rep itself* instead. If you copy a pristine rebuild package and run `run-trial.sh` on it
unmodified, you'll get `hookHeartbeatEverFired: false` and no `activity-log.jsonl` at all — not
because the hooks didn't fire, but because the poller is looking in the wrong place. **Fix:**
always overlay the harness's own `hooks/` + `settings-template.json` (see setup.sh) even when
you're not testing enforcement — confirmed byte-for-byte equivalent enforcement logic to
production (per `tool-log.mjs`'s own header comment: it reimplements
`generateSettingsJson.ts`'s exact spec-lock/untested-contract rules, not a different ruleset),
just correctly instrumented.

**Gotcha 2 — a held-out suite's reported "total" varies per rep, and that's not a different spec
version.** vitest's own summary line (`Tests X failed (Y)`) silently excludes a test file from the
count entirely if it fails to *import* at all (`Cannot find module` — the route was never built).
Only files that imported successfully but failed their assertion get counted. So the *same*
12-file held-out suite can report `heldOutTotal: 12` in one rep and `7` in another, purely because
fewer routes were built in the second — not because a different `generate_spec` output was used.
**Always check `Test Files N failed (N)` vs. `Tests M failed (M)` in the raw
`held-out-rerun.log`** before concluding two reps used different spec versions. This exact
confusion nearly caused two reps to be discarded as "not comparable" before the mechanism was
traced.

**Gotcha 3 — a held-out page test's asserted content might not be that page's own content.** For
Madeline's `/quote` held-out test specifically, the assertion checks whatever page the browser
lands on *after redirects settle* — which, if `/quote` is behind an auth gate and nothing built
it, is the *login page*. The expected string (`"a little something for... Madeline..."`) is the
login page's own copy, captured because the original app also redirected there. A rep whose
gating middleware denylists everything except `/` will pass this check by accident, without ever
addressing `/quote` specifically; a rep using an allowlist of only the tested routes, or no
server-side gating at all, will fail it for an unrelated reason (a raw 404). Don't assume a
held-out pass means "this page was correctly rebuilt" without reading what page was actually
reached.

**Gotcha 4 — LaTeX page-budget trims don't move the page count linearly.** Small text cuts
(10–20 words) frequently have *zero* effect on the final page count in IEEEtran twocolumn output
unless they happen to land right at the actual column-break boundary. When over budget, check
`pdftotext -f <lastpage> -l <lastpage>` to see exactly what's spilling (usually a few bibliography
entries), then cut a whole sentence or citation bundle rather than iterating on word-level trims.
**Cutting a citation that's used nowhere else in the document removes its entry from the compiled
bibliography too** (no `\nocite{*}` in this file) — a genuinely effective way to reclaim a page
without touching load-bearing prose. Always grep the citation key's count across the whole file
before cutting a sentence that cites it, to confirm you're not orphaning a reference someone else
depends on.

**Gotcha 5 — always re-run `bibtex`, not just `pdflatex`, after editing `references.bib`'s
*content*** (not just when citation keys change). `pdflatex` alone will happily keep using a stale
compiled `.bbl` and never tell you. This caused a real stale-reference bug earlier this session.

**Gotcha 6 — never trust an inline `node -e "…"` hook command until it has run through a real
shell.** The shipped untested-contracts hook crashed on every call from v0 until 2026-09-22: the
shell collapsed `\\` inside the double-quoted script, node got `/\/g`, SyntaxError, exit 1, which
Claude Code treats as a non-blocking error. The unit tests only string-matched the command. Fixed
in `e0dc660` with tests that pipe payloads through `/bin/sh`; keep backslashes out of inline hooks.

**Gotcha 7 — vitest's collected-test count lies about denominators everywhere, not just held-out.**
The same import-failure exclusion as Gotcha 2 makes a one-route rep report visible "1/1". Score
against a fixed file denominator from `Test Files` or the JSON reporter (`rescore-astra.mjs`,
`analyze-rep.mjs`), never from `parse-log.mjs`'s `visiblePass/visibleTotal` alone.

**Gotcha 8 — check the harness configuration per rep, not per family.** `settings.json` changed
between four-cell reps 1–3 and 4–5 (a `SubagentStop` hook naming a script `setup.sh` never
copied), unlogged. `ablation/review-2026-09/build-ledger.mjs` hashes every rep's settings; run it
before pooling reps.

**Gotcha 9 — Codex inherits reasoning effort from `~/.codex/config.toml`** (it was `ultra` on
2026-09-22). Pin `-c model_reasoning_effort=…` explicitly on every trial.

**Gotcha 10 — `pgrep -f <script>` matches the waiting loop's own command line.** To chain batches,
wait on the exact PID (`while kill -0 <pid>`), never on a name pattern. And never edit a bash
script while it is running a batch; bash reads scripts incrementally.

**Gotcha 11 — sealed runs.** `ablation/review-2026-09/` runs the agent under `sandbox-exec` with a
deny-`$HOME`-then-allow profile; `smoke-test.sh` must PASS first (it plants a canary). The
`claude` CLI's own OAuth login is separate from the desktop app's and expires; if a trial fails
with `OAuth session expired`, the user has to run `claude` → `/login`.

## 5. Scientific-integrity rules — non-negotiable, established the hard way this session

1. **Pre-declare pass/fail criteria before a rep finishes**, ideally before it starts. Never
   decide what "counts" after seeing the result.
2. **Report every rep, including divergent/unfavorable ones.** Never discard a rep because its
   result doesn't fit the story. When asked to "run more until we get a good one," the correct
   response is to refuse — that's p-hacking — and instead run a pre-declared N and report the
   true aggregate, whatever it is. (This exact request happened this session; it was declined,
   and the honest version was run instead — see the Madeline N=5 entry in `v0-findings.md`.)
3. **Label retrospective vs. prospective explicitly.** Reps that already existed before a specific
   question was asked of them (e.g. the four-cell design's `with-rep-strong1-3`, repurposed later
   to answer a replication question they weren't originally run for) are retrospective. Reps run
   specifically to answer a pre-declared question are prospective. Both are legitimate evidence;
   conflating them without saying so isn't.
4. **Trace mechanism before reporting a number, especially a surprising one.** Every genuinely
   confusing result this session (the 12-vs-7 denominator, Madeline's 1/5 pass rate) turned out to
   have a clean, verifiable mechanical explanation once someone actually read the raw logs instead
   of pattern-matching on the summary numbers. Don't report "it's inconsistent" or invent a
   plausible-sounding story — go find out.
5. **A finding not making it into the paper is not the same as the finding being wrong or
   hidden.** `docs/v0-findings.md` is the permanent, complete record; the manuscript is a curated
   subset chosen for what a reviewer needs and what fits 10 pages. When something gets added to
   the paper and then reverted (this happened with the Madeline N=5 finding: the "1/1, 1/1, 0/1, 0/1" juxtaposition
   reads to a fast reviewer as tool inconsistency, not as the separate verification-signal
   finding it actually is), the findings log keeps the
   correction **without overwriting the original entry** — a new section says what changed and
   why, the old one stays intact.
6. **Never fabricate precision you don't have.** When asked for exact CLI versions and dates for
   older trials, the honest answer was "not contemporaneously logged" rather than filling in the
   current version as if it always applied — even though a reviewer explicitly asked for it. The
   paper says so directly rather than presenting invented precision as fact.

## 6a. Update, later on 2026-09-22

- An adversarial `gpt-6-astra` review (Reject 2/5) found nine real manuscript/log conflicts; all
  were verified against raw records, fixed in the SEIP tex, and logged in `v0-findings.md`. The
  paper is no longer frozen: it reopens once more when the follow-up results land.
- Follow-up experiments E1–E5 are pre-registered in `ablation/review-2026-09/PREREGISTRATION.md`
  (deviations appended in its §9). E1 (ledger), E4b (probes), E4c (live guard challenge) are done;
  E5 (Codex wording) and E2/E3/E4a (20 sealed Haiku reps) were running at handoff time. E6/E7 need
  a non-author and are out of scope.
- All of this is on local branch `review-2026-09`, not pushed or tagged. The paper's artifact tag
  must move to a new `v0.2.13-paper` that includes the committed N=5 evidence and the hook fix.

## 6b. Update, 2026-09-23 (supersedes the tag plan in §6a)

- Merged to main via PRs #39/#40; `rebuild-dossier@0.2.10` is published (npm, GitHub Packages,
  MCP Registry) with the hardened Bash-aware guard and the process-group mutation watchdog.
- Sealed follow-up complete (Haiku 20/20, Sonnet 10/10): no hook effect (E2 0/5 vs 0/5), held-out
  completion tracks over-building (ρ = 0.996). E5 Astra: wording repair confirmed semantic and
  model-specific. §11 effort follow-up: 4/6 done, 2 `rev-ultra` reps pending.
- `v0.2.13-paper` (→ 41672c1) has no release and will be **deleted**; the final paper tag is cut
  on the finished main commit after §11, then a GitHub release → Zenodo version DOI → update the
  tex artifact block (tag, commit, DOI, 611 tests / 90 files, ref [12], intervening-tags list).
- Two external validators follow `docs/validators.md` (pinned 0.2.10). Their reports are the E7
  signal; E6 (independent oracle) still needs a non-author.
- The paper is open for these final edits only; arXiv sync is skipped by the user's decision.

## 6. Current state as of this handoff (2026-09-22)

- SEIP paper: 10 pages, 0 compile errors, 0 undefined citations/refs. Frozen — no further
  proactive edits unless a real external signal arrives (completed outside tester report, or a
  genuine new finding).
- What's *in* the paper from this session's work: self-containedness framing fix, fixture
  renaming (codenames only in two artifact-pointer spots), catchandtrade N=1→6 strong-tier
  corroboration (1 headline + 3 retrospective + 2 prospective reps, denominator mechanism
  explained in one sentence), all four flagged inferential-overreach phrases removed, explicit
  model IDs stated once paper-wide, hook-liveness sentence, "collapses entirely" softened to "no
  gap," methods-caveat unstacking (IV states what was done, VI-D/Threats carries the
  generalization caveats), tone rebalance restoring flat statements for observed results while
  keeping hedges scoped to generalization only.
- What's *not* in the paper, on purpose: the Madeline N=5 divergent-reps finding (real, verified,
  logged in full in `v0-findings.md`, but judged not worth the explanation cost in a 10-page
  paper — see §5.5 above).
- Outreach for an external tester (GitHub Discussion #37, Reddit r/mcp and r/VibeCodeDevs posts)
  is still open, unresolved as of this handoff.
- arXiv report is out of sync with the SEIP paper's latest changes (see §1). Not yet decided
  whether to sync it.

## 7. Auto-memory files worth reading (separate from this repo)

At `/Users/parkerfawcett/.claude/projects/-Users-parkerfawcett-Rebuild-Dossier/memory/`:
`MEMORY.md` (index), `feedback_verify_restated_figures.md`, `feedback_manuscript_vs_findings_log.md`,
`project_rebuild_dossier_emse_paper.md`, `feedback_supplement_framing_self_contained.md`. These
carry cross-session context (EMSE rejection history, why SEIP was chosen, standing feedback about
how the user wants numbers verified and findings bucketed) that this repo's own files don't
contain.
