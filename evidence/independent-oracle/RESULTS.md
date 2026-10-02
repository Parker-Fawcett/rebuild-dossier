# Independent oracle: results (run 2026-10-01, after the freeze in `b74b856`)

These are produced by `score.mjs` from the raw per-target files in `results/`. The full output is in
`score-output.txt`, and the per-run rows are in `scores.csv`.

## The checks against the original
The original at `54d7e65` satisfies **59/59** checks (status and shape). Two runs gave byte-identical
output. No check needed to be excluded.

## Headline
| Target | Full matches on built checks | Notes |
|---|---|---|
| Constant-200 stub | 0 / 59 | Status matches only on the 6 checks that expect `200`. |
| Haiku, all 20, visible routes | 6 / 740 | 0/580 authentication, 0/120 validation. Every one returned `200`. |
| Haiku A+B (10 runs), visible routes | 2 / 370 | Same 370 checks as the Sonnet row. Also built: 46 held-out-route checks, 0 matched (2/416 overall). |
| Sonnet A+B (10 runs), visible routes | 112 / 370 | 72/290 authentication, 30/60 validation, 10/20 other. |

These agree with the author's oracle (`evidence/fidelity-oracle/`):
- Weak-tier rebuilds match **no** authentication or validation check on visible routes, and match
  only some static responses.
- The strong tier infers authentication some of the time.
- Per-run visible-route full matches rank the 30 runs almost identically under both oracles: Spearman
  ρ = 0.995 (ρ = 0.988 on the 10 Sonnet runs). This is descriptive; the two oracles share the
  original app and the same 32 routes.

## What the independent checks found that the author's battery did not
The author's battery sends no query strings. Ahmed's R01-a sends `POST /api/auth?action=logout`.
The original's `/api/auth` dispatches on a `?action=` query parameter: `logout` and `refresh` on POST
(lines 30, 34), `providers` on GET (line 10).

**None of the 30 rebuilds reads that parameter.** A `grep` for `action` or `searchParams` in every
rebuilt `src/app/api/auth/route.ts` finds nothing, and the route is visible-demanded. The strong-tier
rebuilds implement the route as a single email/password login:
- nine of ten answer logout with `400`;
- one returns `200 {ok}` to everything.

The weak-tier rebuilds answer `200` with assorted bodies. The package's contract for this route is
signature-only and does not mention the parameter. This is another omission where the contract is
silent, of the kind the second-application audit also found.

## Notes
- **Trailing-space header (18 checks).** `Authorization: Bearer ` was delivered as `Bearer`, as
  PROTOCOL.md anticipated. For the original, the outcome is the same either way (`401`).
- **AI assistance: none.** Ahmed's `ai_assistance` field reads "none written by me." Asked after
  the run, he confirmed (2026-10-01, relayed by the author) that this means he used no AI
  assistance. `PROTOCOL.md` is left as frozen; it records the field verbatim, noting its meaning was
  pending.
