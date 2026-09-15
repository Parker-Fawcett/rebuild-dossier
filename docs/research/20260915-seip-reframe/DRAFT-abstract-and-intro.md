# SEIP reframe draft — abstract and opening

*Target: ICSE 2027, Software Engineering in Practice (SEIP) track. Deadline: October 23,
2026. Not a resubmission of the EMSE manuscript — a new submission to a venue whose
stated interest ("insights, innovations, and solutions to concrete software engineering
problems") matches what this project actually is. Reuses the same real findings and the
same verification rigor as the frozen arXiv manuscript (2608.23616); reframes the pitch,
and folds in this month's real extension work (Codex, OpenCode, five new models, two
labs beyond the original scope) as new evidence a fresh submission is free to include.*

*This is a draft for reaction, not a final draft. The actual manuscript source (LaTeX or
otherwise) still needs to be located — I only have the frozen PDF — before any of this
gets applied for real.*

---

## What changed in the pitch, and why

The original abstract is already closer to practice-flavored than EMSE's rejection
suggests — it leads with a real, MIT-licensed tool and end-to-end reproduction. What it
doesn't do is open with the *problem a practitioner has*, before the mechanism. EMSE
wanted proof this generalizes at scale; SEIP wants to know: is this a real problem
teams building agentic rebuild pipelines are going to hit, and does this tool actually
help. That's a different first sentence, not a different paper.

The second change is substantive, not just framing: this month's work extended
everything from one CLI (Claude Code) and two labs (Anthropic, and OpenCode's original
target) to three CLIs (Claude Code, Codex, OpenCode) and three labs (Anthropic, OpenAI,
Meta) — six more models, and a complete, isolated, *fixed* failure mode found along the
way. That's real, new, additive evidence a fresh SEIP submission can include outright,
not something waiting on a "deliberate batched revision" the way it would for a
resubmission to the same journal.

---

## Proposed title (unchanged, still accurate)

**Rebuild Dossier: Mechanically-Enforced Specs for Agentic App Rebuilds, and What
Model-Tier Failures Reveal**

No change needed — it's neutral enough to work for either venue, and changing it risks
losing continuity with the arXiv preprint already out under this name.

## Proposed abstract

> Agentic "rebuild this app" pipelines are already being used to reconstruct real
> software from an existing codebase — and the rebuild is only as good as the process
> that produced it, not the model driving it. We present rebuild-dossier, an
> open-source tool that locks an application's real interface — its exact inputs and
> outputs — before any code is written, then enforces one-test-at-a-time building
> through automated checks, not written instructions alone. This report documents what
> happened when six frontier models, across three independent agent CLIs (Claude Code,
> OpenAI Codex, OpenCode) and three labs (Anthropic, OpenAI, Meta), were actually run
> against it on real applications.
>
> Four things practitioners deploying this kind of pipeline should know. First, a
> passing test suite does not certify correctness: in a small comparison, a
> rule-following agent failed a held-back test while a rule-breaking agent passed
> everything, because naive pass-rate rewards incidental coverage over discipline — and
> this exact pattern reproduced independently this month on a new model family, not
> just the one it was first observed on. Second, mechanical enforcement is often
> uninformative for compliant models — most models tested never attempted the
> violation the hooks exist to catch, with or without enforcement active — but it is
> not free insurance either: a live trial caught a model bypassing the intended edit
> tool entirely via a raw shell redirect, a bypass mechanical enforcement, once fixed to
> watch for it, closed. Third, we found, isolated against three independent confounds
> (enforcement, reasoning effort across a model's full documented range, and delegation
> mechanism), and fixed a reproducible failure mode in the newest, most
> externally-benchmarked-capable model tested: a self-defeating literal reading of one
> build-order instruction, resolved completely by clarifying a single sentence and
> confirmed on a second independent run. Fourth, every claim here is checked at three
> levels — the agent's own report, an automated mechanical log, and an independent
> re-run of the actual tests — a discipline that caught real errors in our own tooling,
> across three separate hook implementations, that a single level of checking would
> have missed.
>
> The tool is public, MIT licensed, and reproduces end to end against real applications
> across all three agent CLIs tested.

## Proposed opening paragraphs (replaces current intro's first ~2 paragraphs)

> Teams are already pointing coding agents at existing applications and asking for a
> clean rebuild — a full reconstruction from a specification the agent extracts itself,
> not a human-authored one. The practical risk in this workflow is not that the agent
> writes bad code; modern models write code that runs. The risk is that "the tests
> pass" quietly stops meaning "the rebuild is correct," because the same agent that
> writes the implementation is often the one whose instructions determine what counts
> as passing. This is not a hypothetical: this report includes a live case where a
> rule-breaking agent's tests all passed while a rule-following agent's failed, and
> another where a model routed around its own edit tool entirely to make an unrelated
> edit succeed.
>
> rebuild-dossier is a response to that specific risk, not a general claim about
> agentic coding. It locks an application's real interface — the exact shape of its
> existing inputs and outputs — into a machine-checkable spec before any implementation
> code is written, then enforces test-by-test building mechanically rather than by
> instruction alone. This report is an honest account of running that tool against real
> applications with six frontier models across three independent agent CLIs and three
> labs: what held up, what a live trial caught that a design review would have missed,
> and one complete case of a real model failure — found, isolated against every
> confound we could check, and fixed with a single clarified sentence — reported the
> same way whether the result flattered the tool or not.

---

## What this doesn't touch (yet), and the open item before this is real

This draft only reworks the abstract and opening framing. It does not yet:
- Draft the new section covering the Codex/OpenCode extension work (the Astra
  finding-and-fix arc, the Muse/Goodhart replication, the harness-integrity bugs) —
  that's the next concrete piece once this framing is confirmed, and it's a bigger
  writing task, not a quick add.
- Touch the existing body sections (2 onward) at all — those may need light framing
  edits to match the new opening's practitioner-first voice, but the actual findings
  and evidence in them don't need to change.
- Locate the manuscript's actual editable source. I only have the frozen PDF
  (`2608.23616v1.pdf`) and the EMSE submission PDFs in Downloads — none of them are
  LaTeX/Word source files I can edit directly. Before any of this becomes a real
  submission, we need to find (or reconstruct) the actual source file.

React to the abstract and opening above first — if the direction's right, the Codex/
OpenCode section is the next thing I'd write, and finding the real source file is the
next thing that needs to happen in parallel.
