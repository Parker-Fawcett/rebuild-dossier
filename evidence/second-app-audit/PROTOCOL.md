# Second-application audit: protocol, frozen before the preserved rebuild was evaluated by this battery (2026-10-01)

**App:** `abdoulayebinta/mini-express-recipes-api` at `857d02fb`. It's an Express 4 server with 8
contracted routes, passport-JWT auth, and JSON-file storage. The local copy differs from `857d02fb`
only by the export guard added to `src/index.js` for the validator run.

**Rebuild audited:** the preserved build-from-contracts rebuild in `~/codex-e2e/recipes-api-rebuild`
(files written 2026-09-24 15:18–15:19 local). That matches the **Codex** build-from-contracts run
(findings log, "Build-from-contracts rebuild on Codex, Hyrum's setup", ~21:21Z). The Claude Code
rebuild from earlier that day used the same directory and was overwritten, so it is not audited.
Its package (0.2.13 era) carries handler source in contracts plus three owner-flagged bug
decisions.

**Prior exposure, disclosed:** the author wrote this battery after reading the findings log. That
log already records the rebuild's known differences: JSON error shape, no seed data, flagged bugs
fixed. So checks R02 (seed count) and the error-shape comparisons were written knowing a mismatch
was likely. This is an audit of known-category behavior, not a blind test.

**Battery (`battery.mjs`).** Each run gets a fresh copy of the app (so data files start from their
preserved state), real HTTP, and `JWT_SECRET=audit-secret`. There are 19 checks, R01–R19:
- the redirect;
- the list, plus the seed count;
- a seeded item;
- 401s without a token or with a garbage token, on POST, PUT and DELETE;
- signup new and duplicate;
- login correct, wrong password, and unknown email;
- create with a token, plus an empty-body create;
- get created, update created, delete created;
- malformed JSON;
- a missing id.

**Timing:** the rebuild was generated on 2026-09-24, before this battery existed. "Frozen" means the battery was frozen before the preserved rebuild was evaluated by it (`51cb25d`), not before the rebuild was made.

**Golden (`golden-original-857d02f.json`):** run twice on the original, identical both times.

**Scoring rule (fixed now):**
- **Expected answer:** the original's answer, except for the three owner-flagged checks, where the
  package told the rebuild *not* to reproduce the bug, so the expected answer is the flagged
  intent:
  - R11: login with a wrong password → **401**;
  - R16: PUT created recipe → **200** with `data`;
  - R17: DELETE created recipe → **204**.
- **Match:**
  - The status must be equal, and so must the top-level JSON keys (`non-json`/`empty` compared
    literally).
  - R01 additionally needs the same `Location`.
  - R03, R13 and R15 additionally need the same `data` keys.
  - Flagged checks: status only, plus `data` present for R16.
- **R02 seed:** scored separately, as the list length equal to the original's 12.
- **R19:** the original crashes, giving no response. That is an unflagged original defect, so R19
  is reported descriptively and not scored.
- **Reporting:** the whole battery, check by check, grouped as auth, data and shape, errors, and
  flagged.

## Results (run after the freeze in `51cb25d`; `results-rebuild-codex.json`, `score-output.txt`)

**Rebuild:** the Codex CLI 0.153.4, `gpt-6-astra` at medium effort, built from the 0.2.13 package.
Every contract carried the handler source; three bugs were flagged; there were 0 visible tests.

**Result:** 18 scored checks: **11 status-and-shape matches, 15 status matches.** These are matches under the declared rules, not 11 fully correct behaviors.
- R02 counts as a match despite returning 0 items vs. 12, because the list length is reported separately.
- The flagged checks verify only their stated response criteria, not every downstream effect of each repair.

| Group | Full | Status | Divergence |
|---|---|---|---|
| Flagged bugs (R11, R16, R17) | 3/3 | 3/3 | All fixed as instructed: wrong password → 401, PUT → 200, DELETE → 204 |
| Data and shape (R01–R03, R08, R10, R13, R15) | 6/7 | 6/7 | R03: no seed data. The list is empty (0 items vs. 12), so recipe 1 → 404 |
| Errors (R09, R12, R14, R18) | 0/4 | 4/4 | Error body `{message}` vs. the original's `{status, statusCode, message}` (error middleware) |
| Auth (R04–R07) | 2/4 | 2/4 | **R06/R07: unauthenticated PUT/DELETE on a missing id → 404, where the original returns 401** |
| R19 (unscored) | | | The original crashes on a missing id; the rebuild returns 404 |

**Mechanism behind R06/R07, read from the rebuild's source:** the rebuild moved the original's
`recipeExist` check from the handler chain (`auth.authenticate()` then `recipeExist`) into
`router.param('id')`. Express runs that before any route middleware, so existence is checked
before authentication. For an id that doesn't exist, an unauthenticated caller learns that,
where the original rejects them first. The same relocation is what removed the original's
unflagged missing-id crash (R19).

**The earlier side-by-side missed it.** The 14-request comparison in the findings log
(2026-09-24) recorded "401 without a token" as matched, because it used ids that existed.

**The package's own gate saw none of this.** All 8 generated tests were downgraded to weak:
`spec/test-dependencies.json`, written 15:15, lists only `tests/weak/`. So the package had no
visible or held-out test to fail. (Correction, same day: an earlier draft of this note cited 2
held-out tests. Those came from an earlier generation of the package, at 09:11, not the audited
15:14 package.)

**Limits:**
- One rebuild of one small app, built by a different model and CLI than the sealed study.
- An author-written battery with disclosed prior exposure.
- Data and error-shape gaps were expected; the auth-ordering divergence was not.

## Supplementary matched-state check (2026-10-01; not part of the frozen 18-check score)

`matched-state.mjs`; outputs in `matched-state-original.json` and `matched-state-rebuild.json`.

**Why:** R06/R07 used recipe id 1, which exists in the original's seed data and not in the rebuild,
so the direct comparison also differs in resource state. This check asks both apps the same thing,
with no credentials:

| Resource state | `PUT` original / rebuild | `DELETE` original / rebuild |
|---|---|---|
| Present in both (a recipe each app just created) | 401 / 401 | 401 / 401 |
| Absent in both (id 999999) | 401 / **404** | 401 / **404** |

**Result:** the check-order divergence holds when the state is matched. Where a resource is
missing, the rebuild answers unauthenticated `PUT`/`DELETE` with 404, and the original with 401.
This is a behavioral divergence. It is not an established confidentiality loss, since both apps
expose listing and retrieval without authentication.

## Provenance and what is withheld (`provenance/`)

- **Rebuild:** `rebuild-files.sha256` lists the sha256 of every file in the audited rebuild tree
  as scored (`~/codex-e2e/recipes-api-rebuild`, excluding `node_modules`): its `src/`, data
  files, `spec/` contracts and decisions, `package.json`, lockfile, kickoff and instructions.
  - A private archive of that tree is preserved by the author (`recipes-api-rebuild-audited.tar.gz`,
    sha256 `29cef792…1043`).
  - It is not redistributed here. The application carries no license, and the contracts quote its
    handlers verbatim.
- **Original:** the public repository at `857d02fb`, plus the one local change in
  `original-export-only-change.diff` (the `require.main` guard and `module.exports`).
  `original-working-copy-files.sha256` hashes the working copy that was run.

**Reproduction limit:** the response JSON, battery and scorer are public. Re-running the HTTP
battery needs the original (public) and the rebuild (withheld, verifiable by hash on request).
