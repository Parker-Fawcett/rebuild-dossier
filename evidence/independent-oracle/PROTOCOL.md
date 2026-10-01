# Independent oracle: protocol, frozen before any target was run (2026-10-01)

## Provenance of the checks
`checks-ahmed.json` was written by S. N. Ahmed, who did not build rebuild-dossier. He is first author
of AgentModernize and of *The Coming Legacy Cliff*, the paper's closest prior work, and earlier
reproduced the tool at `v0.2.6-paper`. He was given only:
- the original app (`catchandtrade` at `54d7e65`, cloned from the public repository);
- a list of the 32 method-level routes, with the visible/held-out labels removed;
- instructions and an empty template.

He was asked not to open this repository, the paper, or any rebuild. He reports not having seen the
author's fidelity oracle or its results (`seen_rebuild_dossier_oracle_or_results_before: false`).
He reports 128 minutes of work. His `ai_assistance` field reads, verbatim, "none written by me.";
its meaning is being confirmed with him and is reported verbatim until then.

The file is committed **byte-for-byte as received**. SHA-256:
`af2c744d923299f4167bfd78b3089c34ef2fb9217ecd4d44aab79d9b3f2dc0d4`. No check is edited, added or
dropped, including any check the original turns out not to satisfy.

It holds 59 checks covering all 32 routes, 15 `needs_database` notes, and 6 ambiguity or bug notes.
By expected status:
- 45 expect `401`;
- 8 expect `400`;
- 6 expect `200`.

## Execution
This is the same path as `evidence/fidelity-oracle/` (see its PROTOCOL.md). The same original
checkout, the same 30 frozen snapshots (sha256-checked), and the same constant-200 stub are used, with
the same evaluation-time `node_modules`. `DATABASE_URL` points at a closed port, no other credentials
are set, and each request has an 8 s timeout. `independent.spec.ts` maps each check's method and path
onto its route file and path params, then calls the handler in-process with a `NextRequest`:
- path and query string as written;
- headers as written;
- body JSON-encoded when non-null.

**Known transport effect, decided now:** the Fetch `Headers` class strips trailing whitespace, so
`Authorization: Bearer ` (with a trailing space, which 18 checks use) is delivered as `Bearer`. An
HTTP server's parser does the same, so production would see the same value. The effect applies
identically to every target and is reported, not corrected.

## Scoring rule (fixed now, before any target runs)
- **Status match:** the target's status equals `expect_status`.
- **Full match:** status match, plus the response shape matches.
  - In general, the shape matches when the sorted top-level JSON keys equal the sorted
    `expect_keys`.
  - For R25-a and R32-a, the response must be a JSON array instead: their `expect_keys` is `[]`, and
    their reasons state that the body is a bare array.
- Not built, method missing, import error, throw and timeout are each counted by category, never as
  a match.

**Primary result:** full matches against Ahmed's expectations as written, for each target.

**Validation of the checks themselves:** the same checks are run on the original. Any check the
original does not satisfy is reported as a disagreement between his reading and the code's actual
behavior. It stays in the primary count, and the results are also reported restricted to the checks
the original satisfies.

**Report:**
- per run, per arm and per tier (Haiku all 20; Haiku A+B; Sonnet A+B);
- split by the route's suite (visible-demanded vs. held-out);
- split by category: `401` authentication, `400` validation, `200` other;
- for the stub;
- a comparison with the author's oracle covering:
  - route and category coverage;
  - checks the author's battery has no counterpart for;
  - whether the conclusions agree.

No test statistic is planned. Repeated checks within a run are not independent samples.
